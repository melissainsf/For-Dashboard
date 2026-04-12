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

  // Helper: sleep ms
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Helper: fetch with retry on 429
  async function fetchWithRetry(url, opts, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      const res = await fetch(url, opts);
      if (res.status === 429) {
        if (i < retries) { await sleep(5000); continue; }
        return null;
      }
      return res;
    }
    return null;
  }

  try {
    // Get workspace list — 1 request
    const wsRes = await fetchWithRetry(`${BASE}/workspaces`, { headers });
    if (!wsRes || !wsRes.ok) {
      const t = wsRes ? await wsRes.text() : 'no response';
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ workspaces: [], debug: `Workspaces failed: ${t.slice(0,200)}` }) };
    }

    const wsData = await wsRes.json();
    const workspaces = wsData.workspaces || wsData.data || wsData || [];
    const results = [];

    // Process in batches of 5 to stay well under rate limit
    const BATCH = 5;
    for (let i = 0; i < workspaces.length; i += BATCH) {
      const batch = workspaces.slice(i, i + BATCH);

      const batchResults = await Promise.all(batch.map(async (ws) => {
        const slug = ws.slug || ws.id;
        let forReview = [], posted = [], scheduled = [];

        try {
          const frRes = await fetchWithRetry(`${BASE}/${slug}/posts?status=ForReview&limit=100`, { headers });
          if (frRes && frRes.ok) { const d = await frRes.json(); forReview = d.posts || d.data || []; }
        } catch(e) {}

        try {
          const ppRes = await fetchWithRetry(`${BASE}/${slug}/posts?status=Posted&limit=100&created_at_min=${monthStart}`, { headers });
          if (ppRes && ppRes.ok) { const d = await ppRes.json(); posted = d.posts || d.data || []; }
        } catch(e) {}

        try {
          const spRes = await fetchWithRetry(`${BASE}/${slug}/posts?status=Scheduled&limit=100`, { headers });
          if (spRes && spRes.ok) { const d = await spRes.json(); scheduled = d.posts || d.data || []; }
        } catch(e) {}

        return { workspace: slug, workspaceName: ws.name || slug, forReview, posted, scheduled };
      }));

      results.push(...batchResults);

      // Small pause between batches to avoid rate limiting
      if (i + BATCH < workspaces.length) await sleep(1500);
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
