// Virio CS Dashboard - Lineage health serverless function.
//
// Configure in Netlify env vars:
//   LINEAGE_API_KEY  - the API key from Lineage
//   LINEAGE_API_URL  - the full endpoint URL that returns the per-account health list
//                      (e.g. https://app.virio.ai/api/health). If unset, defaults to
//                      https://app.virio.ai/api/health.
//
// Expected client-side shape: { results: [{ name, account_health }, ...] }.
// On any error, returns { results: [] } so the dashboard renders "—" chips.
exports.handler = async function() {
  const key = process.env.LINEAGE_API_KEY;
  const url = process.env.LINEAGE_API_URL || 'https://app.virio.ai/api/health';

  if (!key) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results: [], error: 'LINEAGE_API_KEY not configured' })
    };
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ results: [], error: `Lineage ${res.status}: ${txt.slice(0, 200)}` })
      };
    }

    const data = await res.json();
    const raw = Array.isArray(data) ? data : (data.results || data.accounts || data.data || []);
    const results = raw.map(r => ({
      name: r.name || r.company || r.account_name || r.account || '',
      account_health: r.account_health || r.health || r.status || r.color || null
    })).filter(r => r.name);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results: [], error: e.message })
    };
  }
};
