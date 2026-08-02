// Virio CS Dashboard — write account health color (dashboard-only).
//
// Health is stored in the dashboard's OWN Netlify Blobs store, keyed by HubSpot
// company id. Lineage is no longer involved.
//
// POST { id, value: "red"|"yellow"|"green"|"blue" | null }
//   value null / "" clears the color for that company.
//
// Note: read-modify-write on a single "map" blob. Edits are manual and
// low-frequency, so the tiny concurrent-write window is acceptable here.
const VALID = new Set(['red', 'yellow', 'green', 'blue']);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const id = body.id;
  if (!id || typeof id !== 'string') return reply(400, { error: 'id required' });
  const value = (body.value == null || body.value === '') ? null : String(body.value).toLowerCase();
  if (value !== null && !VALID.has(value)) return reply(400, { error: `Invalid value "${body.value}"` });

  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('account-health');
    const map = (await store.get('map', { type: 'json' })) || {};
    if (value === null) delete map[id]; else map[id] = value;
    await store.setJSON('map', map);
    return reply(200, { ok: true, id, value });
  } catch (e) {
    return reply(500, { error: e.message });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
