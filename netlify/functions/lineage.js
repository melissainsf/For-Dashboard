// Virio CS Dashboard - Lineage health serverless function.
//
// Configure in Netlify env vars:
//   LINEAGE_API_KEY   - the API key from Lineage
//   LINEAGE_API_URL   - full endpoint URL (default https://app.virio.ai/api/health)
//   LINEAGE_DEBUG=1   - include a raw_sample of the upstream response (for parser tuning)
//
// Expected client-side shape: { results: [{ name, account_health }, ...] }.
// On any error, returns { results: [] } so the dashboard renders "—" chips.
exports.handler = async function() {
  const key = process.env.LINEAGE_API_KEY;
  const url = process.env.LINEAGE_API_URL || 'https://app.virio.ai/api/health';
  const debug = process.env.LINEAGE_DEBUG === '1';

  if (!key) {
    return reply({ results: [], error: 'LINEAGE_API_KEY not configured' });
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Accept': 'application/json'
      }
    });

    const txt = await res.text();
    if (!res.ok) {
      return reply({ results: [], error: `Lineage ${res.status}: ${txt.slice(0, 200)}` });
    }

    let data;
    try { data = JSON.parse(txt); }
    catch { return reply({ results: [], error: 'Non-JSON response', raw_sample: txt.slice(0, 400) }); }

    const raw = Array.isArray(data) ? data : (data.rows || data.results || data.accounts || data.data || data.items || []);
    const results = raw.map(r => ({
      name: r.co || r.name || r.company || r.account_name || r.account || '',
      account_health: r.humanHealth || r.agentHealth || r.account_health || r.health || r.status || r.color || null
    })).filter(r => r.name);

    const payload = { results };
    if (debug || results.length === 0) {
      payload.raw_sample = txt.slice(0, 800);
      payload.top_keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : null;
    }
    return reply(payload);
  } catch (e) {
    return reply({ results: [], error: e.message });
  }
};

function reply(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}

