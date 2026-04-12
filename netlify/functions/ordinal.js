exports.handler = async function(event, context) {
  const ORDINAL_BASE = 'https://api.tryordinal.com';
  const token = process.env.ORDINAL_TOKEN;

  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ORDINAL_TOKEN not set.' }) };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    // ── 1. Get all workspaces ──
    const wsRes = await fetch(`${ORDINAL_BASE}/workspaces`, { headers });
    const wsData = await wsRes.json();
    const workspaces = wsData.workspaces || wsData || [];

    // ── 2. For each workspace, pull ForReview posts and recent Posted posts ──
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const results = await Promise.all(workspaces.map(async (ws) => {
      const slug = ws.slug || ws.id;

      // ForReview posts
      let forReviewPosts = [];
      try {
        const frRes = await fetch(
          `${ORDINAL_BASE}/workspaces/${slug}/posts?status=ForReview&limit=100`,
          { headers }
        );
        const frData = await frRes.json();
        forReviewPosts = frData.posts || [];
      } catch(e) {}

      // Posted posts in last 30 days
      let postedPosts = [];
      try {
        const ppRes = await fetch(
          `${ORDINAL_BASE}/workspaces/${slug}/posts?status=Posted&limit=100&created_at_min=${thirtyDaysAgo}`,
          { headers }
        );
        const ppData = await ppRes.json();
        postedPosts = ppData.posts || [];
      } catch(e) {}

      // Scheduled posts
      let scheduledPosts = [];
      try {
        const spRes = await fetch(
          `${ORDINAL_BASE}/workspaces/${slug}/posts?status=Scheduled&limit=100`,
          { headers }
        );
        const spData = await spRes.json();
        scheduledPosts = spData.posts || [];
      } catch(e) {}

      return {
        workspace: slug,
        workspaceName: ws.name || slug,
        forReview: forReviewPosts,
        posted: postedPosts,
        scheduled: scheduledPosts
      };
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ workspaces: results })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
