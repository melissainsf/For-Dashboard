// Virio CS Dashboard — Lineage per-contact account health (read).
//
// Reads https://api.virio.ai/api/account-health, which returns one row PER
// contact (FOC), each with a compound id "companyId:focUserId" and the
// human-set humanHealth. The dashboard groups these by company to (a) resolve
// which ids to PATCH when a health chip is edited and (b) cross-check display.
//
// Auth: LINEAGE_WRITE_API_KEY (the "Health-write" key). Override the endpoint
// with LINEAGE_HEALTH_URL if it ever moves.
exports.handler = async function() {
  const key = process.env.LINEAGE_WRITE_API_KEY;
  const url = process.env.LINEAGE_HEALTH_URL || 'https://api.virio.ai/api/account-health';
  if (!key) return reply({ rows: [], error: 'LINEAGE_WRITE_API_KEY not configured' });

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
    });
    const txt = await res.text();
    if (!res.ok) return reply({ rows: [], error: `account-health ${res.status}: ${txt.slice(0, 200)}` });

    let data;
    try { data = JSON.parse(txt); }
    catch { return reply({ rows: [], error: 'Non-JSON response', raw_sample: txt.slice(0, 300) }); }

    const raw = Array.isArray(data) ? data : (data.rows || data.results || data.data || []);
    // Slim payload: only what the client needs to map company -> contact ids.
    const rows = raw.map(r => ({
      id: r.id,                       // "companyId:focUserId" — the PATCH target
      companyId: r.companyId || null,
      co: r.co || r.name || r.company || '',
      humanHealth: r.humanHealth || null
    })).filter(r => r.id && r.co);

    return reply({ rows });
  } catch (e) {
    return reply({ rows: [], error: e.message });
  }
};

function reply(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
