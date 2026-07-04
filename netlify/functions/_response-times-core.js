// Core computation for CS response-time medians. Shared by the scheduled job
// (compute-response-times.js) and the manual trigger (run-response-times.js).
//
// Definitions (locked with CS):
//   - Scope: `virio-<client company>` channels matched to Customer-stage accounts.
//   - Clock: each customer message starts a clock; the first reply from ANY Virio
//     teammate stops it. Raw wall-clock (24/7). Median per account; pooled per AM.
//   - Internal vs external is decided by the author's Slack workspace: Virio
//     teammates belong to our team_id; the customer side does not. We resolve each
//     author's team via users.info (cached) — robust for Slack Connect channels.
//   - Reactions: not timed here (Slack history has no reaction timestamp); the
//     go-forward reaction_added event will add that. This job counts message replies.
//   - Storage: Netlify Blobs only. Supabase is never touched.

const ACCOUNTS = require('./_cs-accounts');

const WINDOW_DAYS = 30;
const SLACK = 'https://slack.com/api/';

async function slack(method, params, token) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(SLACK + method + qs, { headers: { Authorization: 'Bearer ' + token } });
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

async function listAllChannels(token) {
  const out = [];
  let cursor;
  do {
    const r = await slack('conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200',
      ...(cursor ? { cursor } : {}),
    }, token);
    out.push(...(r.channels || []));
    cursor = r.response_metadata ? r.response_metadata.next_cursor : null;
  } while (cursor);
  return out;
}

async function channelHistory(channelId, oldest, token) {
  const out = [];
  let cursor;
  do {
    const r = await slack('conversations.history', {
      channel: channelId, oldest, limit: '200', ...(cursor ? { cursor } : {}),
    }, token);
    out.push(...(r.messages || []));
    cursor = r.has_more && r.response_metadata ? r.response_metadata.next_cursor : null;
  } while (cursor);
  return out;
}

async function computeAndStore(token) {
  const auth = await slack('auth.test', null, token);
  const virioTeamId = auth.team_id;

  const channels = await listAllChannels(token);
  const virioChannels = channels.filter((c) => /^virio-/.test(c.name || ''));
  const oldest = (Date.now() / 1000 - WINDOW_DAYS * 86400).toFixed(6);

  // Cache each author's workspace so we classify internal vs external reliably.
  const userTeam = {};
  async function teamOf(uid) {
    if (!uid) return null;
    if (uid in userTeam) return userTeam[uid];
    try { const r = await slack('users.info', { user: uid }, token); userTeam[uid] = r.user ? r.user.team_id : null; }
    catch (e) { userTeam[uid] = null; }
    return userTeam[uid];
  }

  const accounts = [];
  const amLat = {};
  const matched = [];
  const unmatched = [];

  for (const acct of ACCOUNTS) {
    const ch = virioChannels.find((c) => norm(c.name).startsWith('virio' + norm(acct.company)));
    let latencies = [];
    if (ch) {
      matched.push({ company: acct.company, channel: ch.name });
      try {
        const msgs = (await channelHistory(ch.id, oldest, token))
          .filter((m) => !m.subtype && m.user) // drop joins / system / bot posts
          .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        for (const uid of [...new Set(msgs.map((m) => m.user))]) await teamOf(uid); // warm cache
        const isInternal = (m) => userTeam[m.user] === virioTeamId;
        for (let i = 0; i < msgs.length; i++) {
          if (isInternal(msgs[i])) continue;               // internal msg, not a customer prompt
          for (let j = i + 1; j < msgs.length; j++) {       // first Virio reply after it
            if (isInternal(msgs[j])) { latencies.push(parseFloat(msgs[j].ts) - parseFloat(msgs[i].ts)); break; }
          }
        }
      } catch (e) { /* channel read failed — leave latencies empty */ }
    } else {
      unmatched.push(acct.company);
    }
    accounts.push({
      company: acct.company, am: acct.am, product: acct.product,
      median_seconds: median(latencies), sample: latencies.length,
      channel: ch ? ch.name : null,
    });
    (amLat[acct.am] = amLat[acct.am] || []).push(...latencies);
  }

  const ams = Object.keys(amLat).map((am) => {
    const accts = accounts.filter((a) => a.am === am);
    const mix = accts.reduce((m, a) => { const k = a.product === 'EGC' ? 'EGC' : 'FS'; m[k] = (m[k] || 0) + 1; return m; }, {});
    return { am, accounts: accts.length, product_mix: mix, median_seconds: median(amLat[am]), sample: amLat[am].length };
  });

  const payload = { generated_at: new Date().toISOString(), window_days: WINDOW_DAYS, source: 'slack', accounts, ams };

  const { getStore } = require('@netlify/blobs');
  await getStore('response-times').setJSON('latest', payload);

  return { payload, matched, unmatched };
}

module.exports = { computeAndStore, WINDOW_DAYS };
