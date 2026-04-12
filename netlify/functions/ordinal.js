exports.handler = async function(event, context) {
  const token = process.env.ORDINAL_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ORDINAL_TOKEN not set.' }) };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const BASE = 'https://app.tryordinal.com/api/v1/company';
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function safeFetch(url) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      const d = await res.json();
      return d.posts || d.data || [];
    } catch(e) { return null; }
  }

  try {
    // 1 request: get workspaces
    const wsRes = await fetch(`${BASE}/workspaces`, { headers });
    if (!wsRes.ok) {
      const t = await wsRes.text();
      return { statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ workspaces: [], debug: `Workspaces ${wsRes.status}: ${t.slice(0,200)}` }) };
    }

    const wsData = await wsRes.json();
    const workspaces = wsData.workspaces || wsData.data || wsData || [];
    const results = [];

    // Process sequentially with a small gap — avoids rate limiting, avoids parallel timeout
    for (const ws of workspaces) {
      const slug = ws.slug || ws.id;

      const forReview = await safeFetch(`${BASE}/${slug}/posts?status=ForReview&limit=100`) || [];
      await sleep(300);
      const scheduled = await safeFetch(`${BASE}/${slug}/posts?status=Scheduled&limit=100`) || [];
      await sleep(300);
      const posted = await safeFetch(`${BASE}/${slug}/posts?status=Posted&limit=50&created_at_min=${monthStart}`) || [];
      await sleep(300);

      results.push({ workspace: slug, workspaceName: ws.name || slug, forReview, scheduled, posted });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ workspaces: results })
    };
  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ workspaces: [], debug: `Exception: ${e.message}` })
    };
  }
};
