// Scheduled job: compute CS response-time medians from Slack and store them in
// Netlify Blobs for the dashboard widgets to read.
//
// STATUS: wired but DORMANT until a Slack bot token is provided. It no-ops
// (returns 204) whenever SLACK_BOT_TOKEN is unset, so it's safe to deploy now.
//
// To activate:
//   1. Create a Slack app / bot with scopes: channels:history, groups:history,
//      channels:read, groups:read, reactions:read, users:read  (+ subscribe to
//      the `reaction_added` event for exact reaction timing going forward).
//   2. Invite the bot to the `virio-<client>` customer channels.
//   3. Set SLACK_BOT_TOKEN in the viriodash Netlify env (same place as
//      LINEAGE_API_KEY). Storage is Netlify Blobs only — Supabase is untouched.
//
// Definitions (locked with CS):
//   - Scope: only `virio-<client company>` channels, matched to Customer-stage
//     accounts (see _cs-accounts.js).
//   - Clock: every customer message starts a clock; the first reply from ANY
//     Virio teammate stops it. Raw wall-clock (24/7).
//   - Metric: median per account; pooled across accounts per AM.
//   - Reactions: a Virio reaction also stops the clock, BUT Slack's history API
//     does not expose WHEN a reaction was added, so reaction latency can only be
//     captured going forward via the reaction_added event. This batch job counts
//     message replies; the event handler (future) will add reaction timing.

const ACCOUNTS = require('./_cs-accounts');

const WINDOW_DAYS = 30;
const SLACK = 'https://slack.com/api/';

// Run hourly at :17 (off the :00 rush).
exports.config = { schedule: '17 * * * *' };

async function slack(method, params, token) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(SLACK + method + qs, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(method + ': ' + json.error);
  return json;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Pull a channel's message history (paginated) within the window and return the
// list of customer-message -> first-Virio-reply latencies in seconds.
async function channelLatencies(channelId, oldest, virioTeamId, token) {
  const msgs = [];
  let cursor;
  do {
    const res = await slack('conversations.history', {
      channel: channelId, oldest, limit: '200', ...(cursor ? { cursor } : {}),
    }, token);
    msgs.push(...(res.messages || []));
    cursor = res.has_more && res.response_metadata ? res.response_metadata.next_cursor : null;
  } while (cursor);

  msgs.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts)); // oldest -> newest

  // Internal = authored by a Virio-workspace member. On Slack Connect channels
  // the author's workspace id appears on the message; internal authors match our team.
  const isInternal = (m) => m && !m.subtype && m.user &&
    (m.team === virioTeamId || m.user_team === virioTeamId);
  const isCustomerMsg = (m) => m && !m.subtype && m.user &&
    m.team && m.team !== virioTeamId && m.user_team !== virioTeamId;

  const latencies = [];
  for (let i = 0; i < msgs.length; i++) {
    if (!isCustomerMsg(msgs[i])) continue;
    const start = parseFloat(msgs[i].ts);
    // First Virio reply after this customer message (channel-level).
    // TODO: also walk thread replies (conversations.replies) for threaded convos.
    for (let j = i + 1; j < msgs.length; j++) {
      if (isInternal(msgs[j])) { latencies.push(parseFloat(msgs[j].ts) - start); break; }
    }
  }
  return latencies;
}

exports.handler = async function () {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log('compute-response-times: SLACK_BOT_TOKEN not set — skipping (dormant).');
    return { statusCode: 204 };
  }

  // Our own workspace id; anything else in a Connect channel is the customer side.
  const auth = await slack('auth.test', null, token);
  const virioTeamId = auth.team_id;

  // Every virio-* channel the bot can see.
  const channels = [];
  let cursor;
  do {
    const res = await slack('conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200',
      ...(cursor ? { cursor } : {}),
    }, token);
    channels.push(...(res.channels || []));
    cursor = res.response_metadata ? res.response_metadata.next_cursor : null;
  } while (cursor);
  const virioChannels = channels.filter((c) => /^virio-/.test(c.name || ''));

  const oldest = (Date.now() / 1000 - WINDOW_DAYS * 86400).toFixed(6);

  const accounts = [];
  const amLatencies = {}; // am -> pooled latencies (for a true per-AM median)
  for (const acct of ACCOUNTS) {
    // Channel scope rule: `virio-<company>` (optionally `-<contact>` after).
    const ch = virioChannels.find((c) => norm(c.name).startsWith('virio' + norm(acct.company)));
    let latencies = [];
    if (ch) {
      try { latencies = await channelLatencies(ch.id, oldest, virioTeamId, token); }
      catch (e) { console.log(`channel ${ch.name}: ${e.message}`); }
    }
    accounts.push({
      company: acct.company, am: acct.am, product: acct.product,
      median_seconds: median(latencies), sample: latencies.length,
      channel: ch ? ch.name : null,
    });
    (amLatencies[acct.am] = amLatencies[acct.am] || []).push(...latencies);
  }

  // Per-AM rollup: pooled median across the AM's accounts + product mix.
  const ams = Object.keys(amLatencies).map((am) => {
    const accts = accounts.filter((a) => a.am === am);
    const mix = accts.reduce((m, a) => {
      const k = a.product === 'EGC' ? 'EGC' : 'FS'; m[k] = (m[k] || 0) + 1; return m;
    }, {});
    return {
      am, accounts: accts.length, product_mix: mix,
      median_seconds: median(amLatencies[am]), sample: amLatencies[am].length,
    };
  });

  const payload = {
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS, source: 'slack', accounts, ams,
  };

  const { getStore } = require('@netlify/blobs');
  await getStore('response-times').setJSON('latest', payload);

  console.log(`compute-response-times: wrote ${accounts.length} accounts, ${ams.length} AMs.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, accounts: accounts.length }) };
};
