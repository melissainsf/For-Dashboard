// Ordinal proxy — two modes to keep each invocation well under the 10s Netlify limit:
//   GET /api/ordinal              -> { workspaces: [{slug, name}, ...] }
//   GET /api/ordinal?slug=<slug>  -> { workspace, workspaceName, forReview, scheduled, posted }
// Token stays server-side; browser avoids CORS and rate-limit exposure.

exports.handler = async function(event) {
  const token = process.env.ORDINAL_TOKEN;
  if (!token) {
    return json(500, { error: 'ORDINAL_TOKEN not set.' });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  const BASE = 'https://app.tryordinal.com/api/v1/company';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function safeFetch(url) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return { ok: false, status: res.status, data: [] };
      const d = await res.json();
      return { ok: true, status: 200, data: d.posts || d.data || [] };
    } catch(e) { return { ok: false, status: 0, data: [], error: e.message }; }
  }

  const slug = event.queryStringParameters && event.queryStringParameters.slug;
  const probe = event.queryStringParameters && event.queryStringParameters.probe;

  try {
    // Probe mode: try multiple candidate URL patterns and report which one works.
    // Visit /api/ordinal?probe=vendelux-alex to run it.
    if (probe) {
      const root = 'https://app.tryordinal.com/api/v1';
      const candidates = [
        `${root}/company/${probe}/posts?status=ForReview&limit=1`,
        `${root}/${probe}/posts?status=ForReview&limit=1`,
        `${root}/workspace/${probe}/posts?status=ForReview&limit=1`,
        `${root}/workspaces/${probe}/posts?status=ForReview&limit=1`,
        `${root}/company/${probe}/posts?status=forreview&limit=1`,
        `${root}/company/${probe}/posts?limit=1`,
        `${root}/posts?workspace=${probe}&status=ForReview&limit=1`,
        `${root}/company/${probe}/post?status=ForReview&limit=1`,
        // Company-scoped endpoints that might accept Company API keys:
        `${root}/company/posts?workspace=${probe}&status=ForReview&limit=1`,
        `${root}/company/posts?workspace_slug=${probe}&status=ForReview&limit=1`,
        `${root}/company/posts?slug=${probe}&status=ForReview&limit=1`,
        `${root}/company/workspace/${probe}/posts?status=ForReview&limit=1`,
        `${root}/company/workspaces/${probe}/posts?status=ForReview&limit=1`,
        // Root endpoints and introspection:
        `${root}`,
        `${root}/company`,
      ];
      const probed = [];
      for (const url of candidates) {
        try {
          const res = await fetch(url, { headers });
          let bodySnippet = '';
          try { const t = await res.text(); bodySnippet = t.slice(0, 180); } catch(_) {}
          probed.push({ url, status: res.status, body: bodySnippet });
        } catch(e) {
          probed.push({ url, status: 0, error: e.message });
        }
        await sleep(200);
      }
      return json(200, { probe, results: probed });
    }

    // Mode 1: no slug -> return just the workspace list (dedupe by slug)
    if (!slug) {
      const wsRes = await fetch(`${BASE}/workspaces`, { headers });
      if (!wsRes.ok) {
        const t = await wsRes.text();
        return json(200, { workspaces: [], debug: `Workspaces ${wsRes.status}: ${t.slice(0,200)}` });
      }
      const wsData = await wsRes.json();
      const raw = wsData.workspaces || wsData.data || wsData || [];
      const seen = new Set();
      const workspaces = raw
        .map(w => ({ slug: w.slug || w.id, name: w.name || w.slug || w.id }))
        .filter(w => { if (!w.slug || seen.has(w.slug)) return false; seen.add(w.slug); return true; });
      return json(200, { workspaces });
    }

    // Mode 2: slug provided -> fetch 3 status queries for that workspace
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const forReview = await safeFetch(`${BASE}/${encodeURIComponent(slug)}/posts?status=ForReview&limit=100`);
    await sleep(350);
    const scheduled = await safeFetch(`${BASE}/${encodeURIComponent(slug)}/posts?status=Scheduled&limit=100`);
    await sleep(350);
    const posted = await safeFetch(`${BASE}/${encodeURIComponent(slug)}/posts?status=Posted&limit=50&created_at_min=${encodeURIComponent(monthStart)}`);

    return json(200, {
      workspace: slug,
      forReview: forReview.data,
      scheduled: scheduled.data,
      posted: posted.data,
      debug: {
        forReview: forReview.status,
        scheduled: scheduled.status,
        posted: posted.status
      }
    });
  } catch(e) {
    return json(200, { workspaces: [], debug: `Exception: ${e.message}` });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
