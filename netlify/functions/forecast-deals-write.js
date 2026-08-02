// Virio CS Dashboard — write manually-tracked deal numbers (ICP clients).
//
// Stored in the dashboard's own Netlify Blobs store, keyed by HubSpot company id.
//
// POST { id, deals: { cc, cv, pc, pv } }
//   cc = closed count, cv = closed $, pc = pipeline count, pv = pipeline $.
//   Non-numeric/negative values are coerced to 0. An all-zero entry is removed.
//
// Note: read-modify-write on a single "map" blob; manual, low-frequency edits.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const id = body.id;
  if (!id || typeof id !== 'string') return reply(400, { error: 'id required' });
  const d = body.deals || {};
  const entry = { cc: num(d.cc), cv: num(d.cv), pc: num(d.pc), pv: num(d.pv) };
  const empty = entry.cc === 0 && entry.cv === 0 && entry.pc === 0 && entry.pv === 0;

  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('forecast-deals');
    const map = (await store.get('map', { type: 'json' })) || {};
    if (empty) delete map[id]; else map[id] = entry;
    await store.setJSON('map', map);
    return reply(200, { ok: true, id, deals: entry });
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
