// Virio CS Dashboard — write human health back to Lineage.
//
//   PATCH https://api.virio.ai/api/account-health/{id}/health   { "humanHealth": "yellow" }
//
// Health in Lineage is per contact (FOC), so a company can have several ids.
// Per Melissa's rule ("if one contact is happy, the company is happy"), a single
// dashboard edit applies the chosen color to EVERY contact id passed in. The
// client resolves the ids for a company; this function validates and PATCHes each.
//
// Body: { ids: ["companyId:focUserId", ...], humanHealth: "red|yellow|green|blue" | null }
// null clears the human score (falls back to the AI/agent score in Lineage).
// Auth: LINEAGE_WRITE_API_KEY.
const VALID = new Set(['red', 'yellow', 'green', 'blue']);
const ID_RE = /^[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$/;  // "uuid:uuid"

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  const key = process.env.LINEAGE_WRITE_API_KEY;
  if (!key) return reply(500, { error: 'LINEAGE_WRITE_API_KEY not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string' && ID_RE.test(x)) : [];
  const hh = (body.humanHealth == null || body.humanHealth === '') ? null : String(body.humanHealth).toLowerCase();
  if (!ids.length) return reply(400, { error: 'No valid contact ids provided' });
  if (hh !== null && !VALID.has(hh)) return reply(400, { error: `Invalid humanHealth "${body.humanHealth}"` });

  const base = process.env.LINEAGE_HEALTH_URL || 'https://api.virio.ai/api/account-health';
  const results = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}/health`, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ humanHealth: hh })
      });
      const txt = await res.text();
      results.push({ id, status: res.status, ok: res.ok, body: txt.slice(0, 120) });
    } catch (e) {
      results.push({ id, ok: false, error: e.message });
    }
  }

  const allOk = results.every(r => r.ok);
  return reply(allOk ? 200 : 502, { ok: allOk, results });
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
