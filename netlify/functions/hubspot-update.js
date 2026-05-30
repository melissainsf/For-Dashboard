// Virio CS Dashboard - HubSpot company property updater.
// POST { id, property, value } -> PATCH /crm/v3/objects/companies/{id}
// Requires HUBSPOT_TOKEN with `crm.objects.companies.write` scope.
const ALLOWED_PROPERTIES = new Set(['customer_journey', 'csm', 'pilot_status', 'kickoff_call_date', 'first_post_date', 'stage', 'vertical']);
const DATE_PROPERTIES = new Set(['kickoff_call_date', 'first_post_date']);

function normalizeDate(v) {
  // HubSpot date properties want midnight UTC ms. Accept YYYY-MM-DD input.
  if (v === '' || v === null || v === undefined) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10));
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'POST only' });
  }
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return reply(500, { error: 'HUBSPOT_TOKEN not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return reply(400, { error: 'Invalid JSON body' }); }

  const { id, property, value } = body;
  if (!id || !property) return reply(400, { error: 'id and property required' });
  if (!ALLOWED_PROPERTIES.has(property)) return reply(400, { error: `Property "${property}" not allowed` });

  const sendValue = DATE_PROPERTIES.has(property) ? normalizeDate(value) : (value === '' ? null : value);

  try {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ properties: { [property]: sendValue } })
    });
    const txt = await res.text();
    if (!res.ok) {
      return reply(res.status, { error: `HubSpot ${res.status}: ${txt.slice(0, 300)}` });
    }
    return reply(200, { ok: true });
  } catch (e) {
    return reply(500, { error: e.message });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
