// Core for the AM bonus quarterly snapshots.
//
// The bonus calculator needs to know how much of an account's expansion landed
// IN a given quarter, and each AM's previous-quarter NRR. HubSpot only stores a
// single cumulative `expansion_mrr` with no timestamp, so we snapshot each
// account's MRR components at the start of every quarter into the dashboard's
// own Netlify Blobs store ('bonus-snapshots'). Then:
//   this-quarter expansion = current expansion_mrr − start-of-quarter snapshot
//   previous-quarter NRR    = start-of-current-Q totals ÷ start-of-previous-Q totals
//
// Snapshots are captured automatically by a scheduled function at each quarter
// start (capture-bonus-snapshot.js) and can be seeded on demand via the
// capture-if-absent write endpoint (bonus-snapshot-write.js). Shared by both.

const STORE = 'bonus-snapshots';

// Same company query the dashboard uses (see functions/hubspot.js) — the NRR
// cohort plus pilot-tracked accounts — but we only keep the money fields.
const HS_BODY = {
  filterGroups: [
    { filters: [{ propertyName: 'pilot_status', operator: 'IN',
      values: ['In progress', 'Converted', 'Exited During Pilot', 'Churned Post Conversion'] }] },
    { filters: [{ propertyName: 'lifecyclestage', operator: 'IN', values: ['customer', '1271359806'] }] }
  ],
  properties: ['name', 'lifecyclestage', 'mrr', 'expansion_mrr', 'churned_mrr_value',
               'domain', 'csm', 'kickoff_call_date'],
  limit: 200
};

function quarterLabel(date) {
  return date.getUTCFullYear() + '-Q' + (Math.floor(date.getUTCMonth() / 3) + 1);
}
function prevQuarterLabel(label) {
  const [y, q] = label.split('-Q').map(Number);
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

async function fetchAccounts(token) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(HS_BODY)
  });
  if (!res.ok) throw new Error('HubSpot search failed: ' + res.status);
  const data = await res.json();
  const out = {};
  (data.results || []).forEach(r => {
    const p = r.properties || {};
    out[r.id] = {
      name: p.name || p.domain || r.id,
      csm: p.csm || null,
      domain: p.domain || null,
      lifecyclestage: p.lifecyclestage || null,
      kickoff_date: p.kickoff_call_date || null,
      mrr: parseFloat(p.mrr) || 0,
      expansion_mrr: parseFloat(p.expansion_mrr) || 0,
      churned_mrr: parseFloat(p.churned_mrr_value) || 0
    };
  });
  return out;
}

function getBlobStore(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  if (typeof connectLambda === 'function') connectLambda(event);
  return getStore(STORE);
}

// Capture the current quarter's baseline. Idempotent: an existing snapshot for
// the quarter is left untouched unless force=true (so the baseline isn't
// accidentally reset to mid-quarter). Returns a summary.
async function captureSnapshot(event, { force = false } = {}) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error('HUBSPOT_TOKEN not set');
  const store = getBlobStore(event);
  const quarter = quarterLabel(new Date());

  const existing = await store.get(quarter, { type: 'json' });
  if (existing && !force) {
    return { ok: true, quarter, skipped: true, reason: 'already captured', accounts: Object.keys(existing.accounts || {}).length };
  }

  const accounts = await fetchAccounts(token);
  const snapshot = { quarter, captured_at: new Date().toISOString(), accounts };
  await store.setJSON(quarter, snapshot);
  return { ok: true, quarter, skipped: false, forced: force, accounts: Object.keys(accounts).length };
}

// Read every stored quarterly snapshot: { snapshots: { "2026-Q3": {...}, ... } }.
async function readSnapshots(event) {
  const store = getBlobStore(event);
  const snapshots = {};
  const { blobs } = await store.list();
  for (const b of (blobs || [])) {
    const snap = await store.get(b.key, { type: 'json' });
    if (snap) snapshots[b.key] = snap;
  }
  return snapshots;
}

module.exports = { STORE, quarterLabel, prevQuarterLabel, fetchAccounts, captureSnapshot, readSnapshots };
