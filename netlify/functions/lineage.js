// Virio CS Dashboard - Lineage (customer health) serverless function
// Reads account health from the Lineage Supabase project. account_health_states
// has RLS with no public policy, so this runs server-side with the service-role
// key (SUPABASE_SERVICE_ROLE_KEY) and is never exposed to the browser.
exports.handler = async function(event) {
  const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://ylplirptcybuzxnecsgp.supabase.co').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    return json(500, { error: 'SUPABASE_SERVICE_ROLE_KEY environment variable is not set.' });
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Accept': 'application/json'
  };
  const url = SUPABASE_URL + '/rest/v1/account_health_states' +
    '?select=user_company_id,human_health,health_explanation,human_health_at,updated_at,user_companies(name,domains)';

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return json(res.status, { error: 'Lineage query failed (' + res.status + '): ' + t.slice(0, 200) });
    }
    const rows = await res.json();

    // Collapse to one record per company; most recently updated health wins.
    const byCompany = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const co = row.user_companies;
      const key = row.user_company_id;
      if (!co || !key) return;
      const ts = row.human_health_at || row.updated_at || '';
      const existing = byCompany[key];
      if (!existing || ts > existing._ts) {
        byCompany[key] = {
          name: co.name || '',
          domains: Array.isArray(co.domains) ? co.domains : [],
          health: row.human_health || null,
          explanation: row.health_explanation || '',
          updated_at: row.human_health_at || row.updated_at || null,
          _ts: ts
        };
      }
    });
    const result = Object.values(byCompany).map(({ _ts, ...rec }) => rec);

    return json(200, result);
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
