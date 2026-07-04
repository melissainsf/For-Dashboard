// Core computation for CS response-time medians. Shared by the scheduled job
// (compute-response-times.js) and the manual trigger (run-response-times.js).
//
// Definitions (locked with CS):
//   - Scope: `virio-<client company>` channels matched to Customer-stage accounts.
//   - Clock: each customer message starts a clock; the first reply from ANY Virio
//     teammate stops it. Raw wall-clock (24/7). Median per account; pooled per AM.
//   - Internal vs external is decided by the author's Slack workspace: Virio
//     teammates belong to our team_id; the customer side does not. We resolve each
//     author's team via users.info (cached) — robust for Slack Connect channels.
//   - Reactions: not timed here (Slack history has no reaction timestamp); the
//     go-forward reaction_added event will add that. This job counts message replies.
//   - Storage: Netlify Blobs only. Supabase is never touched.

const ACCOUNTS = require('./_cs-accounts');

const WINDOW_DAYS = 30;
const SLACK = 'https://slack.com/api/';

async function slack(method, params, token) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(SLACK + method + qs, { headers: { Authorization: 'Bearer ' + token } });
  const json = await res.json();
  if (!json.ok) throw new Error(method + ': ' + json.error);
  return json;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Match a `virio-<company>` channel to an account. Handles both the full/joined
// name (e.g. "virio-innovo-commerce-x" for InnovoCommerce) and abbreviated
// multi-word names (e.g. "virio-hume-andrew" for "Hume AI", "virio-concord-kevin"
// for "Concord Visa"), by also matching on the company's first word.
function channelMatches(channelName, company) {
  if (norm(channelName).startsWith('virio' + norm(company))) return true;
  const chTok = tokens(channelName);          // e.g. ['virio','hume','andrew']
  const coTok = tokens(company);              // e.g. ['hume','ai']
  return chTok[0] === 'virio' && chTok[1] && coTok[0] && chTok[1] === coTok[0];
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = (nums) => (nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null);

async function listAllChannels(token) {
  const out = [];
  let cursor;
  do {
    const r = await slack('conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200',
      ...(cursor ? { cursor } : {}),
    }, token);
    out.push(...(r.channels || []));
    cursor = r.response_metadata ? r.response_metadata.next_cursor : null;
  } while (cursor);
  return out;
}

async function channelHistory(channelId, oldest, token) {
  const out = [];
  let cursor;
  do {
    const r = await slack('conversations.history', {
      channel: channelId, oldest, limit: '200', ...(cursor ? { cursor } : {}),
    }, token);
    out.push(...(r.messages || []));
    cursor = r.has_more && r.response_metadata ? r.response_metadata.next_cursor : null;
  } while (cursor);
  return out;
}

// Pull the customer list + Account Manager + Product LIVE from HubSpot each run,
// so the widgets always match HubSpot (no static drift). Falls back to the bundled
// snapshot (_cs-accounts.js) if HubSpot is unavailable.
const AM_LABEL = { 'CSM 2': 'David', 'Max': 'Maxwell' };      // HubSpot csm internal name -> dropdown label
const FORMER_AMS = new Set(['Yichen', 'Lakeisha', 'Emmett']); // former team members -> Unassigned
function amLabel(csm) {
  if (!csm || FORMER_AMS.has(csm)) return 'Unassigned';
  return AM_LABEL[csm] || csm;
}
async function fetchRoster(hsToken) {
  const roster = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      properties: ['name', 'csm', 'product'], limit: 100, ...(after ? { after } : {}),
    };
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hsToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HubSpot ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    for (const c of (data.results || [])) {
      const name = c.properties && c.properties.name;
      if (!name || name === 'Virio') continue; // exclude Virio's own record
      roster.push({
        company: name,
        am: amLabel(c.properties.csm),
        product: c.properties.product === 'EGC' ? 'EGC' : 'Full Service',
      });
    }
    after = data.paging && data.paging.next && data.paging.next.after;
  } while (after);
  return roster;
}

async function computeAndStore(token) {
  const auth = await slack('auth.test', null, token);
  const virioTeamId = auth.team_id;

  const channels = await listAllChannels(token);
  const virioChannels = channels.filter((c) => /^virio-/.test(c.name || ''));
  const oldest = (Date.now() / 1000 - WINDOW_DAYS * 86400).toFixed(6);

  // Live roster from HubSpot; fall back to the bundled snapshot on failure.
  let roster, rosterSource = 'hubspot';
  try {
    roster = process.env.HUBSPOT_TOKEN ? await fetchRoster(process.env.HUBSPOT_TOKEN) : null;
  } catch (e) {
    console.log('response-times: HubSpot roster fetch failed, using bundled snapshot —', e.message);
    roster = null;
  }
  if (!roster || !roster.length) { roster = ACCOUNTS; rosterSource = 'snapshot'; }

  // Cache each author's workspace so we classify internal vs external reliably.
  const userTeam = {};
  async function teamOf(uid) {
    if (!uid) return null;
    if (uid in userTeam) return userTeam[uid];
    try { const r = await slack('users.info', { user: uid }, token); userTeam[uid] = r.user ? r.user.team_id : null; }
    catch (e) { userTeam[uid] = null; }
    return userTeam[uid];
  }

  const accounts = [];
  const amLat = {};
  const amProdLat = {};
  const matched = [];
  const unmatched = [];

  for (const acct of roster) {
    const ch = virioChannels.find((c) => channelMatches(c.name, acct.company));
    // Exclude accounts with no Slack channel (email-only customers, or not yet
    // onboarded). They reappear automatically once a virio-<company> channel exists.
    if (!ch) { unmatched.push(acct.company); continue; }
    matched.push({ company: acct.company, channel: ch.name });
    let latencies = [];
    try {
      const msgs = (await channelHistory(ch.id, oldest, token))
        .filter((m) => !m.subtype && m.user) // drop joins / system / bot posts
        .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
      for (const uid of [...new Set(msgs.map((m) => m.user))]) await teamOf(uid); // warm cache
      const isInternal = (m) => userTeam[m.user] === virioTeamId;
      for (let i = 0; i < msgs.length; i++) {
        if (isInternal(msgs[i])) continue;               // internal msg, not a customer prompt
        for (let j = i + 1; j < msgs.length; j++) {       // first Virio reply after it
          if (isInternal(msgs[j])) { latencies.push(parseFloat(msgs[j].ts) - parseFloat(msgs[i].ts)); break; }
        }
      }
    } catch (e) { /* channel read failed — leave latencies empty */ }
    accounts.push({
      company: acct.company, am: acct.am, product: acct.product,
      median_seconds: median(latencies), mean_seconds: mean(latencies), sample: latencies.length,
      channel: ch.name,
    });
    (amLat[acct.am] = amLat[acct.am] || []).push(...latencies);
    const pk = acct.product === 'EGC' ? 'EGC' : 'Full Service';
    amProdLat[acct.am] = amProdLat[acct.am] || {};
    (amProdLat[acct.am][pk] = amProdLat[acct.am][pk] || []).push(...latencies);
  }

  const ams = Object.keys(amLat).map((am) => {
    const accts = accounts.filter((a) => a.am === am);
    const mix = accts.reduce((m, a) => { const k = a.product === 'EGC' ? 'EGC' : 'FS'; m[k] = (m[k] || 0) + 1; return m; }, {});
    // Pooled stats per product so filtered views stay pooled (not median-of-medians).
    const byProduct = {};
    for (const p of ['EGC', 'Full Service']) {
      const lat = (amProdLat[am] && amProdLat[am][p]) || [];
      byProduct[p] = {
        accounts: accts.filter((a) => a.product === p).length,
        median_seconds: median(lat), mean_seconds: mean(lat), sample: lat.length,
      };
    }
    return {
      am, accounts: accts.length, product_mix: mix,
      median_seconds: median(amLat[am]), mean_seconds: mean(amLat[am]), sample: amLat[am].length,
      by_product: byProduct,
    };
  });

  const payload = { generated_at: new Date().toISOString(), window_days: WINDOW_DAYS, source: 'slack', roster_source: rosterSource, accounts, ams };

  const { getStore } = require('@netlify/blobs');
  await getStore('response-times').setJSON('latest', payload);

  return { payload, matched, unmatched };
}

module.exports = { computeAndStore, WINDOW_DAYS };
