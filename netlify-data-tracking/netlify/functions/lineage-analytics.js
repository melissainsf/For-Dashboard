// Netlify Content Performance Dashboard — Lineage analytics sync.
//
// Pulls the customer's content analytics from Lineage and returns a normalized,
// date-filtered shape the dashboard can render directly.
//
// Netlify environment variables (Site configuration → Environment variables):
//   LINEAGE_API_KEY        (required) — the Lineage API key.
//   LINEAGE_ANALYTICS_URL  (optional) — exact analytics data endpoint. If the
//                                       default guesses don't work, set this to
//                                       the real endpoint and everything lights up.
//   LINEAGE_ACCOUNT        (optional) — account slug. Default: "netlify".
//   LINEAGE_SINCE          (optional) — ISO start date. Default: "2026-04-14".
//   LINEAGE_DEBUG=1        (optional) — include raw upstream sample for tuning.
//
// On any failure it returns 200 with { ok:false, error, debug } so the dashboard
// can show a friendly "not connected yet" state instead of crashing.

const DEFAULT_SINCE = '2026-04-14';

exports.handler = async function () {
  const key = process.env.LINEAGE_API_KEY;
  const account = process.env.LINEAGE_ACCOUNT || 'netlify';
  const since = process.env.LINEAGE_SINCE || DEFAULT_SINCE;
  const debug = process.env.LINEAGE_DEBUG === '1';

  if (!key) {
    return reply({ ok: false, error: 'LINEAGE_API_KEY not configured', overview: {}, posts: [] });
  }

  // Candidate analytics endpoints. The explicit env var wins; otherwise we try a
  // few plausible shapes so the dashboard can connect without a code change.
  const candidates = [];
  if (process.env.LINEAGE_ANALYTICS_URL) candidates.push(process.env.LINEAGE_ANALYTICS_URL);
  candidates.push(
    `https://app.virio.ai/api/lineage/${account}/analytics`,
    `https://app.virio.ai/api/analytics?account=${encodeURIComponent(account)}`,
    `https://app.virio.ai/api/${account}/analytics`,
    `https://app.virio.ai/api/analytics/${account}`
  );

  const headers = { Authorization: 'Bearer ' + key, Accept: 'application/json' };
  const attempts = [];
  let data = null, usedUrl = null, rawSample = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET', headers });
      const txt = await res.text();
      if (!res.ok) { attempts.push({ url, status: res.status, body: txt.slice(0, 120) }); continue; }
      try { data = JSON.parse(txt); usedUrl = url; rawSample = txt.slice(0, 1200); break; }
      catch { attempts.push({ url, status: res.status, note: 'non-JSON', body: txt.slice(0, 120) }); }
    } catch (e) {
      attempts.push({ url, error: e.message });
    }
  }

  if (!data) {
    return reply({ ok: false, error: 'Could not reach a working analytics endpoint', overview: {}, posts: [], debug: { attempts } });
  }

  // Locate the array of per-post records wherever it lives in the payload.
  const rawPosts = firstArray(data, ['posts', 'results', 'data', 'items', 'content', 'rows', 'analytics']);
  const sinceTs = Date.parse(since);

  const posts = rawPosts
    .map(normalizePost)
    .filter(p => p.date == null || isNaN(sinceTs) || Date.parse(p.date) >= sinceTs)
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));

  const overview = buildOverview(posts, data);

  const payload = { ok: true, account, since, generatedAt: new Date().toISOString(), overview, posts };
  if (debug || posts.length === 0) {
    payload.debug = { usedUrl, attempts, topKeys: isObj(data) ? Object.keys(data) : null, rawSample, samplePost: rawPosts[0] || null };
  }
  return reply(payload);
};

// ── Normalization ────────────────────────────────────────────────
function normalizePost(r) {
  if (!isObj(r)) return { raw: r };
  const num = (...keys) => { for (const k of keys) { const v = pick(r, k); if (v != null && v !== '') { const n = Number(String(v).replace(/[, %]/g, '')); if (!isNaN(n)) return n; } } return null; };
  const str = (...keys) => { for (const k of keys) { const v = pick(r, k); if (v != null && v !== '') return String(v); } return null; };

  const impressions = num('impressions', 'views', 'impression_count', 'reach', 'total_impressions');
  const reactions   = num('reactions', 'likes', 'reaction_count', 'like_count', 'total_reactions');
  const comments    = num('comments', 'comment_count', 'total_comments');
  const reposts     = num('reposts', 'shares', 'repost_count', 'share_count', 'total_reposts');
  const clicks      = num('clicks', 'click_count', 'link_clicks');
  let engagementRate = num('engagement_rate', 'engagementRate', 'engagement');
  const engagements = (reactions || 0) + (comments || 0) + (reposts || 0) + (clicks || 0);
  if (engagementRate == null && impressions) engagementRate = +((engagements / impressions) * 100).toFixed(2);

  return {
    date: str('date', 'posted_at', 'postedAt', 'published_at', 'publishedAt', 'created_at', 'createdAt', 'timestamp'),
    url: str('url', 'permalink', 'link', 'post_url', 'postUrl'),
    text: str('text', 'caption', 'title', 'content', 'body', 'message'),
    author: str('author', 'author_name', 'creator', 'name', 'person'),
    impressions, reactions, comments, reposts, clicks, engagements,
    engagementRate
  };
}

function buildOverview(posts, data) {
  // Prefer an upstream summary object if one exists; otherwise derive from posts.
  const summary = isObj(data) ? (data.overview || data.summary || data.totals || data.stats || null) : null;
  const sum = k => posts.reduce((s, p) => s + (p[k] || 0), 0);
  const totalImpr = sum('impressions');
  const totalEng = sum('engagements');

  const o = {
    totalPosts: posts.length,
    totalImpressions: totalImpr,
    totalReactions: sum('reactions'),
    totalComments: sum('comments'),
    totalReposts: sum('reposts'),
    totalClicks: sum('clicks'),
    totalEngagements: totalEng,
    avgEngagementRate: totalImpr ? +((totalEng / totalImpr) * 100).toFixed(2) : null,
    avgImpressionsPerPost: posts.length ? Math.round(totalImpr / posts.length) : 0
  };
  // Surface any follower/audience figure the API gives us, since posts won't have it.
  if (summary && isObj(summary)) {
    for (const k of ['followers', 'follower_count', 'audience', 'new_followers', 'follower_growth']) {
      if (summary[k] != null) o[k] = summary[k];
    }
  }
  return o;
}

// ── Tiny helpers ─────────────────────────────────────────────────
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function pick(o, k) { return o[k] != null ? o[k] : o[k && k.toLowerCase && k.toLowerCase()]; }
function firstArray(data, keys) {
  if (Array.isArray(data)) return data;
  if (!isObj(data)) return [];
  for (const k of keys) if (Array.isArray(data[k])) return data[k];
  // Fall back to the first array-valued property anywhere at top level.
  for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  return [];
}

function reply(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
