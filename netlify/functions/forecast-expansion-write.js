// Virio CS Dashboard — write the AM-entered "Target Expansion Close Date".
//
// Stored in the dashboard's own Netlify Blobs store, keyed by HubSpot company id.
//
// POST { id, date: "YYYY-MM-DD" }
//   A blank/invalid date removes the entry.
//
// Note: read-modify-write on a single "map" blob; manual, low-frequency edits.
function validDate(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : v.trim();
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const id = body.id;
  if (!id || typeof id !== 'string') return reply(400, { error: 'id required' });
  const date = validDate(body.date);

  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('forecast-expansion');
    const map = (await store.get('map', { type: 'json' })) || {};
    if (date) map[id] = date; else delete map[id];
    await store.setJSON('map', map);
    return reply(200, { ok: true, id, date: date || null });
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
