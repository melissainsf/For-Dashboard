exports.handler = async function(event, context) {
  const token = process.env.ORDINAL_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ORDINAL_TOKEN not set.' }) };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const BASE        = 'https://app.tryordinal.com/api/v1/company';
  const POSTS_BASE  = 'https://app.tryordinal.com/api/v1/company';

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  try {
    // Get workspace list
    const wsRes = await fetch(`${BASE}/workspaces`, { headers });
    if (!wsRes.ok) {
      const t = await wsRes.text();
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ workspaces: [], debug: `Workspaces ${wsRes.status}: ${t.slice(0,200)}` }) };
    }

    const wsData = await wsRes.json();
    const workspaces = wsData.workspaces || wsData.data || wsData || [];

    const results = await Promise.all(workspaces.map(async (ws) => {
      const slug = ws.slug || ws.id;
      let forReview = [], posted = [], scheduled = [], debugMsg = '';

      // Posts live at /{slug}/posts not /workspaces/{slug}/posts
      try {
        const frRes = await fetch(`${POSTS_BASE}/${slug}/posts?status=ForReview&limit=100`, { headers });
        if (frRes.ok) {
          const d = await frRes.json();
          forReview = d.posts || d.data || [];
        } else {
          debugMsg += `ForReview ${frRes.status} `;
        }
      } catch(e) { debugMsg += `ForReview err: ${e.message} `; }

      try {
        const ppRes = await fetch(`${POSTS_BASE}/${slug}/posts?status=Posted&limit=100&created_at_min=${monthStart}`, { headers });
        if (ppRes.ok) { const d = await ppRes.json(); posted = d.posts || d.data || []; }
      } catch(e) {}

      try {
        const spRes = await fetch(`${POSTS_BASE}/${slug}/posts?status=Scheduled&limit=100`, { headers });
        if (spRes.ok) { const d = await spRes.json(); scheduled = d.posts || d.data || []; }
      } catch(e) {}

      return { workspace: slug, workspaceName: ws.name || slug, forReview, posted, scheduled, debug: debugMsg || undefined };
    }));

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
