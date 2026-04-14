// Ordinal proxy modes (each invocation stays well under Netlify's 10s limit):
//   GET /api/ordinal               -> { workspaces: [{slug, name, id}, ...] }
//   GET /api/ordinal?mint-keys=1   -> one-time: mints a workspace API key per workspace and
//                                     returns a {slug: key} map. Copy into Netlify env var
//                                     ORDINAL_WORKSPACE_KEYS as JSON. Also probes candidate
//                                     post URLs with a newly-minted key so we can lock in
//                                     the right endpoint.
//   GET /api/ordinal?slug=<slug>   -> { workspace, forReview, scheduled, posted }
//                                     Uses the per-workspace key from ORDINAL_WORKSPACE_KEYS
//                                     when available, otherwise falls back to the company key.
//   GET /api/ordinal?probe=<slug>  -> legacy URL-pattern probe (kept for diagnostics)

exports.handler = async function(event) {
  const companyToken = process.env.ORDINAL_TOKEN;
  if (!companyToken) {
    return json(500, { error: 'ORDINAL_TOKEN not set.' });
  }

  // Optional env var: JSON map { "slug": "ord_w_...", ... } produced by ?mint-keys=1
  let workspaceKeys = {};
  if (process.env.ORDINAL_WORKSPACE_KEYS) {
    try { workspaceKeys = JSON.parse(process.env.ORDINAL_WORKSPACE_KEYS) || {}; }
    catch(_) { workspaceKeys = {}; }
  }

  const companyHeaders = { 'Authorization': `Bearer ${companyToken}`, 'Content-Type': 'application/json' };
  const COMPANY_BASE = 'https://app.tryordinal.com/api/v1/company';
  const ROOT = 'https://app.tryordinal.com/api/v1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const q = event.queryStringParameters || {};
  const slug = q.slug;
  const probe = q.probe;
  const mintKeys = q['mint-keys'];

  try {
    // ── MINT MODE ────────────────────────────────────────────────
    if (mintKeys) {
      const wsRes = await fetch(`${COMPANY_BASE}/workspaces`, { headers: companyHeaders });
      if (!wsRes.ok) {
        return json(200, { error: `Workspaces ${wsRes.status}: ${await wsRes.text().then(t => t.slice(0,200))}` });
      }
      const wsData = await wsRes.json();
      const raw = wsData.workspaces || wsData.data || wsData || [];
      const seen = new Set();
      const workspaces = raw.filter(w => {
        const key = w.slug || w.id;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return !!w.id; // need UUID to mint
      });

      const map = {};
      const errors = {};
      for (const ws of workspaces) {
        try {
          const r = await fetch(`${COMPANY_BASE}/workspaces/${ws.id}/api-keys`, {
            method: 'POST',
            headers: companyHeaders,
            body: JSON.stringify({ name: `dashboard-readonly-${ws.slug}` })
          });
          if (!r.ok) {
            errors[ws.slug] = { status: r.status, body: (await r.text()).slice(0, 200) };
          } else {
            const d = await r.json();
            if (d.key) map[ws.slug] = d.key;
            else errors[ws.slug] = { status: 200, body: 'no key in response', raw: d };
          }
        } catch(e) { errors[ws.slug] = { error: e.message }; }
        await sleep(100);
      }

      // Probe candidate post URLs with a freshly-minted workspace key so we know
      // exactly which URL to use in slug mode.
      const firstSlug = Object.keys(map)[0];
      const firstKey = map[firstSlug];
      const probes = [];
      if (firstKey) {
        const wsHeaders = { 'Authorization': `Bearer ${firstKey}`, 'Content-Type': 'application/json' };
        const candidates = [
          `${ROOT}/posts?status=ForReview&limit=1`,
          `${ROOT}/posts?workspace=${firstSlug}&status=ForReview&limit=1`,
          `${COMPANY_BASE}/${firstSlug}/posts?status=ForReview&limit=1`,
          `${ROOT}/${firstSlug}/posts?status=ForReview&limit=1`,
        ];
        for (const url of candidates) {
          try {
            const r = await fetch(url, { headers: wsHeaders });
            const t = await r.text();
            probes.push({ url, status: r.status, body: t.slice(0, 200) });
          } catch(e) { probes.push({ url, error: e.message }); }
          await sleep(150);
        }
      }

      return json(200, {
        instructions: 'Copy the value of `map` (as compact JSON) into a Netlify env var named ORDINAL_WORKSPACE_KEYS, then redeploy.',
        minted: Object.keys(map).length,
        failed: Object.keys(errors).length,
        firstSlugProbed: firstSlug,
        probes,
        map,
        errors
      });
    }

    // ── LEGACY PROBE MODE ────────────────────────────────────────
    if (probe) {
      const candidates = [
        `${ROOT}/company/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}/workspace/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}/workspaces/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}/company/${probe}/posts?status=forreview&limit=1`,
        `${ROOT}/company/${probe}/posts?limit=1`,
        `${ROOT}/posts?workspace=${probe}&status=ForReview&limit=1`,
        `${ROOT}/company/${probe}/post?status=ForReview&limit=1`,
        `${ROOT}/company/posts?workspace=${probe}&status=ForReview&limit=1`,
        `${ROOT}/company/posts?workspace_slug=${probe}&status=ForReview&limit=1`,
        `${ROOT}/company/posts?slug=${probe}&status=ForReview&limit=1`,
        `${ROOT}/company/workspace/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}/company/workspaces/${probe}/posts?status=ForReview&limit=1`,
        `${ROOT}`,
        `${COMPANY_BASE}`,
      ];
      const probed = [];
      for (const url of candidates) {
        try {
          const res = await fetch(url, { headers: companyHeaders });
          const t = await res.text().catch(() => '');
          probed.push({ url, status: res.status, body: t.slice(0, 180) });
        } catch(e) { probed.push({ url, status: 0, error: e.message }); }
        await sleep(200);
      }
      return json(200, { probe, results: probed });
    }

    // ── WORKSPACE LIST ───────────────────────────────────────────
    if (!slug) {
      const wsRes = await fetch(`${COMPANY_BASE}/workspaces`, { headers: companyHeaders });
      if (!wsRes.ok) {
        const t = await wsRes.text();
        return json(200, { workspaces: [], debug: `Workspaces ${wsRes.status}: ${t.slice(0,200)}` });
      }
      const wsData = await wsRes.json();
      const raw = wsData.workspaces || wsData.data || wsData || [];
      const seen = new Set();
      const workspaces = raw
        .map(w => ({ slug: w.slug || w.id, name: w.name || w.slug || w.id, id: w.id }))
        .filter(w => { if (!w.slug || seen.has(w.slug)) return false; seen.add(w.slug); return true; });
      return json(200, { workspaces });
    }

    // ── POSTS FOR A SINGLE WORKSPACE ─────────────────────────────
    // Use workspace API key if available, else fall back to company key (will 403).
    const wsKey = workspaceKeys[slug];
    const headers = wsKey
      ? { 'Authorization': `Bearer ${wsKey}`, 'Content-Type': 'application/json' }
      : companyHeaders;

    // URL to be confirmed by mint-keys probe results. Best current guess: /api/v1/posts
    // (workspace-scoped by the key itself). If that's not right, we'll adjust after
    // running ?mint-keys=1 once.
    const postsUrl = (status, extra = '') =>
      `${ROOT}/posts?status=${status}&limit=100${extra}`;

    async function safeFetch(url) {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          return { ok: false, status: res.status, data: [], err: t.slice(0, 160) };
        }
        const d = await res.json();
        return { ok: true, status: 200, data: d.posts || d.data || [] };
      } catch(e) { return { ok: false, status: 0, data: [], err: e.message }; }
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const forReview = await safeFetch(postsUrl('ForReview'));
    await sleep(300);
    const scheduled = await safeFetch(postsUrl('Scheduled'));
    await sleep(300);
    const posted    = await safeFetch(postsUrl('Posted', `&created_at_min=${encodeURIComponent(monthStart)}&limit=50`));

    return json(200, {
      workspace: slug,
      usedWorkspaceKey: !!wsKey,
      forReview: forReview.data,
      scheduled: scheduled.data,
      posted: posted.data,
      debug: {
        forReview: forReview.status, forReviewErr: forReview.err,
        scheduled: scheduled.status, scheduledErr: scheduled.err,
        posted: posted.status, postedErr: posted.err
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
