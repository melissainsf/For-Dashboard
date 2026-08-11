// Live billing pull from Measure (formerly Maple Billing) for the Forecasting
// renewal board. Mirrors the response-times pattern: a scheduled job computes a
// per-account billing map and writes it to Netlify Blobs ('billing' store), and
// the reader (billing.js) serves that blob, falling back to the committed
// snapshot (_cs-billing.js) whenever the blob is absent.
//
// Auth: MEASURE_API_TOKEN (Bearer). Base URL: MEASURE_API_BASE, default the
// documented public API host. The account/roster still comes from HubSpot
// (HUBSPOT_TOKEN) so billing keys line up with the dashboard's company names.
//
// Measure's REST docs are not reachable from the build environment, so the
// "find" endpoints are tried against the documented path shapes and the first
// that answers 2xx is used (logged). Any hard failure leaves the blob untouched
// and the board keeps rendering the snapshot — this never breaks prod.

const MEASURE_BASE = (process.env.MEASURE_API_BASE || 'https://api.maplebilling.com/api/v1').replace(/\/+$/, '');
const SUB_PATHS = ['/subscriptions/find', '/find-subscriptions', '/subscriptions/search'];
const INV_PATHS = ['/invoices/find', '/find-invoices', '/invoices/search'];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const cents = (m) => (m && typeof m.value_in_cents === 'number') ? m.value_in_cents / 100 : 0;
const domainOf = (email) => { const at = (email || '').split('@')[1]; return at ? at.toLowerCase().replace(/^www\./, '') : null; };

// POST a find/query body, trying each candidate path until one answers 2xx.
// 404/405 → try the next shape; 401/403 (auth/policy) → stop immediately.
async function measureFind(pathCandidates, body, token) {
  let lastErr;
  for (const p of pathCandidates) {
    const url = MEASURE_BASE + p;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) { lastErr = new Error(p + ' → ' + e.message); continue; }
    if (res.ok) return { path: p, json: await res.json() };
    const detail = p + ' → ' + res.status;
    if (res.status === 404 || res.status === 405) { lastErr = new Error(detail + ' (trying next path)'); continue; }
    throw new Error(detail + ': ' + (await res.text().catch(() => '')).slice(0, 160));
  }
  throw lastErr || new Error('no candidate path responded');
}

// Page through a find endpoint (Measure returns pagination.from_key for the next page).
async function measureFindAll(pathCandidates, query, sortKey, token) {
  const out = [];
  let fromKey = null, usePath = null, guard = 0;
  do {
    const body = { query, sort_key: sortKey, pagination: { limit: 200, ...(fromKey ? { from_key: fromKey } : {}) } };
    const { path, json } = await measureFind(usePath ? [usePath] : pathCandidates, body, token);
    usePath = path; // lock onto the working path for subsequent pages
    const results = (json && json.results) || [];
    out.push(...results);
    fromKey = (json && json.pagination && json.pagination.from_key) || null;
    if (results.length < 200) fromKey = null; // last page
  } while (fromKey && ++guard < 50);
  return { results: out, path: usePath };
}

// Customer/billing emails on a subscription/invoice record, for domain matching.
function custEmails(rec) {
  const c = (rec && rec.customer) || {};
  const list = [c.identifier, c.email, ...((c.billing_emails) || [])].filter(Boolean);
  return list;
}

// Roster from HubSpot: customer-stage companies with name + domain, so billing
// keys match the dashboard's company names. (Same source as the other widgets.)
async function fetchHubspotRoster(hsToken) {
  const roster = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      properties: ['name', 'domain'], limit: 100, ...(after ? { after } : {}),
    };
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hsToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HubSpot ' + res.status + ': ' + (await res.text()).slice(0, 160));
    const data = await res.json();
    for (const c of (data.results || [])) {
      const name = c.properties && c.properties.name;
      if (!name || name === 'Virio') continue;
      roster.push({ name, domain: (c.properties.domain || '').toLowerCase().replace(/^www\./, '') || null });
    }
    after = data.paging && data.paging.next && data.paging.next.after;
  } while (after);
  return roster;
}

// Match a HubSpot company to a Measure subscription: domain first (most
// reliable — e.g. Disasters Inc. → TerraFort via grady@terrafort.com), then
// name prefix, then first significant token.
function pickSub(company, subs) {
  const c = norm(company.name);
  if (company.domain) {
    const hit = subs.find((s) => s._domains.includes(company.domain));
    if (hit) return hit;
  }
  const byName = subs.find((s) => { const o = norm(s._org); return o && c && (o.startsWith(c) || c.startsWith(o)); });
  if (byName) return byName;
  const ct = tokens(company.name);
  if (ct[0] && ct[0].length >= 4) {
    const byTok = subs.find((s) => tokens(s._org)[0] === ct[0]);
    if (byTok) return byTok;
  }
  return null;
}

// Build the billing map keyed by HubSpot company name. Returns the full payload
// plus matched/unmatched lists for validation.
async function computeBillingMap(hsToken, measureToken) {
  // Active, paying subscriptions.
  const subRes = await measureFindAll(SUB_PATHS, { status: 'ACTIVE', mrr: { gt: 0 } }, 'mrrDesc', measureToken);
  const subs = subRes.results.map((s) => ({
    _org: (s.customer && s.customer.org_name) || (s.customer && s.customer.display_name) || '',
    _domains: [...new Set(custEmails(s).map(domainOf).filter(Boolean))],
    customer_id: s.customer_id || (s.customer && s.customer.id) || null,
    next_invoice_date: s.next_invoice_date || null,
    amount: Math.round(cents(s.mrr)),
  }));

  // Overdue invoices → aggregate per customer (earliest due date + total due).
  const invRes = await measureFindAll(INV_PATHS, { status: 'OVERDUE', hide_zero: true }, 'dueDateAsc', measureToken);
  const overdueByCust = {};
  for (const inv of invRes.results) {
    const cid = inv.customer_id || (inv.customer && inv.customer.id);
    if (!cid) continue;
    const due = cents(inv.due) || cents(inv.total);
    const when = inv.due_date || inv.invoice_date || null;
    const cur = overdueByCust[cid] || { overdue_since: null, overdue_amount: 0 };
    cur.overdue_amount += Math.round(due);
    if (when && (!cur.overdue_since || new Date(when) < new Date(cur.overdue_since))) cur.overdue_since = when;
    overdueByCust[cid] = cur;
  }

  const roster = await fetchHubspotRoster(hsToken);
  const accounts = {};
  const matched = [], unmatched = [];
  for (const co of roster) {
    const sub = pickSub(co, subs);
    if (!sub) { unmatched.push(co.name); continue; }
    const od = (sub.customer_id && overdueByCust[sub.customer_id]) || null;
    accounts[co.name] = {
      next_invoice_date: sub.next_invoice_date,
      amount: sub.amount,
      overdue_since: od ? od.overdue_since : null,
      overdue_amount: od ? od.overdue_amount : 0,
    };
    matched.push({ company: co.name, org: sub._org });
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: 'measure',
    currency: 'USD',
    accounts,
  };
  return { payload, matched, unmatched, subPath: subRes.path, invPath: invRes.path, subCount: subs.length, overdueCount: invRes.results.length };
}

async function computeAndStore(event, hsToken, measureToken) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  if (typeof connectLambda === 'function') connectLambda(event);
  const result = await computeBillingMap(hsToken, measureToken);
  await getStore('billing').setJSON('latest', result.payload);
  return result;
}

module.exports = { computeBillingMap, computeAndStore, MEASURE_BASE };
