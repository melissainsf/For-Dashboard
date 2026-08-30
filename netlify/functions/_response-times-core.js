// Core computation for CS response-time medians. Shared by the scheduled job
// (compute-response-times.js) and the manual trigger (run-response-times.js).
//
// Definitions (locked with CS):
//   - Scope: `virio-<client company>` channels matched to Customer-stage accounts.
//   - Clock: each BURST of customer messages starts one clock, timed from the
//     first message in the burst; the first reply from ANY Virio teammate stops
//     it. Messages less than BURST_GAP_SECONDS apart are the same burst, so a
//     client who sends five lines in a row costs one measurement, not five.
//     Raw wall-clock (24/7). Median per account; pooled per AM.
//   - Internal vs external is decided by the author's Slack workspace: Virio
//     teammates belong to our team_id; the customer side does not. We resolve each
//     author's team via users.info (cached) — robust for Slack Connect channels.
//   - Reactions: not timed here (Slack history has no reaction timestamp); the
//     go-forward reaction_added event will add that. This job counts message replies.
//   - Storage: Netlify Blobs only. Supabase is never touched.

const ACCOUNTS = require('./_cs-accounts');

const WINDOW_DAYS = 30;
// Consecutive customer messages closer together than this are one prompt.
const BURST_GAP_SECONDS = 600;
const SLACK = 'https://slack.com/api/';

async function slack(method, params, token) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(SLACK + method + qs, { headers: { Authorization: 'Bearer ' + token } });
  const json = await res.json();
  if (!json.ok) throw new Error(method + ': ' + json.error);
  return json;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Match a client Slack channel to an account.
//
// The old rule was `/^virio-/` plus a prefix test, and it quietly dropped real
// channels while matching empty ones. Audited against the live workspace, it
// missed:
//   - `othello-virio`        — the company name comes FIRST
//   - `ext-watt-virio`       — an `ext-` prefix, Virio last
//   - `ext-virio-sourcera`   — an `ext-` prefix, Virio in the middle
//   - `virio-madwestpartners`— "Madison West Partners", abbreviated per word
// and it matched `virio-othello-`, a channel HubSpot Breeze auto-creates that
// holds nothing but join events, in preference to the real conversation.
//
// So: strip the `virio` and `ext` tokens wherever they sit, then compare what is
// left. A channel must still carry a `virio` token to be a candidate at all,
// which keeps `lino-trimble-*` and partner channels out.
const CHANNEL_NOISE = new Set(['virio', 'ext']);
function channelCore(channelName) {
  return tokens(channelName).filter((t) => !CHANNEL_NOISE.has(t));
}

// Does `s` read as the company's words abbreviated and run together?
// "madwestpartners" vs ["madison","west","partners"] -> mad|west|partners.
// Every word must contribute at least two characters and the whole string must
// be consumed, which is what stops "createanything" matching "Crescendo".
function abbreviates(s, words) {
  let i = 0;
  for (const w of words) {
    let k = 0;
    while (k < w.length && i + k < s.length && s[i + k] === w[k]) k++;
    if (k < 2) return false;
    i += k;
  }
  return i === s.length;
}

function channelMatches(channelName, company) {
  const chTok = tokens(channelName);
  if (!chTok.includes('virio')) return false;      // not a Virio client channel
  const core = channelCore(channelName);
  if (!core.length) return false;
  const joined = core.join('');
  const coTok = tokens(company);
  const co = coTok.join('');
  if (!co) return false;

  if (joined.startsWith(co)) return true;          // virio-hyperspell-conor
  if (co.startsWith(joined) && joined.length >= 4) return true;  // virio-magnific / "Magnific (Freepik)"
  if (core[0] === coTok[0]) return true;           // virio-hume-andrew / "Hume AI"
  return abbreviates(joined, coTok);               // virio-madwestpartners
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = (nums) => (nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null);

// "Business hours" elapsed time: counts only 07:00–22:00 local (i.e. excludes
// 10pm–7am). Weekends ARE counted (Virio works Saturdays/Sundays). Timezone is
// configurable below — change BUSINESS_TZ if the reference should differ.
const BUSINESS_TZ = 'America/Los_Angeles';
const DAY_START = 7, DAY_END = 22;
function tzOffsetSec(epochSec) {
  const d = new Date(epochSec * 1000);
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const loc = new Date(d.toLocaleString('en-US', { timeZone: BUSINESS_TZ }));
  return (loc - utc) / 1000;
}
function businessSeconds(start, end) {
  if (end <= start) return 0;
  const off = tzOffsetSec(start);
  const STEP = 300;
  let total = 0;
  for (let t = start; t < end; t += STEP) {
    const h = Math.floor((((((t + off) / 3600) % 24) + 24) % 24));
    if (h >= DAY_START && h < DAY_END) total += Math.min(STEP, end - t);
  }
  return total;
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

// Pull the customer list + Account Manager + Product LIVE from HubSpot each run,
// so the widgets always match HubSpot (no static drift). Falls back to the bundled
// snapshot (_cs-accounts.js) if HubSpot is unavailable.
const AM_LABEL = { 'CSM 2': 'David', 'Max': 'Maxwell' };      // HubSpot csm internal name -> dropdown label
// Off the AM roster -> "Unassigned". HubSpot internal values, not display
// labels ('CSM 2' is David). Mirrors FORMER_AM_VALUES in index.html — keep the
// two in sync.
const FORMER_AMS = new Set([
  'Yichen', 'Lakeisha', 'Emmett', 'Jacob',
  'CSM 2',            // David — left Virio
  'Millie',
  'Former Employee',  // HubSpot's catch-all for departed staff
]);
function amLabel(csm) {
  if (!csm || FORMER_AMS.has(csm)) return 'Unassigned';
  return AM_LABEL[csm] || csm;
}
async function fetchRoster(hsToken) {
  const roster = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      properties: ['name', 'csm', 'product'], limit: 100, ...(after ? { after } : {}),
    };
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hsToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HubSpot ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    for (const c of (data.results || [])) {
      const name = c.properties && c.properties.name;
      if (!name || name === 'Virio') continue; // exclude Virio's own record
      roster.push({
        company: name,
        am: amLabel(c.properties.csm),
        product: c.properties.product === 'EGC' ? 'EGC' : 'Full Service',
      });
    }
    after = data.paging && data.paging.next && data.paging.next.after;
  } while (after);
  return roster;
}

async function computeAndStore(token) {
  const auth = await slack('auth.test', null, token);
  const virioTeamId = auth.team_id;

  const channels = await listAllChannels(token);
  const virioChannels = channels.filter((c) => tokens(c.name || '').includes('virio'));
  const oldest = (Date.now() / 1000 - WINDOW_DAYS * 86400).toFixed(6);

  // Live roster from HubSpot; fall back to the bundled snapshot on failure.
  let roster, rosterSource = 'hubspot';
  try {
    roster = process.env.HUBSPOT_TOKEN ? await fetchRoster(process.env.HUBSPOT_TOKEN) : null;
  } catch (e) {
    console.log('response-times: HubSpot roster fetch failed, using bundled snapshot —', e.message);
    roster = null;
  }
  if (!roster || !roster.length) { roster = ACCOUNTS; rosterSource = 'snapshot'; }

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
  const amBizLat = {};
  const amProdLat = {};
  const matched = [];
  const unmatched = [];

  for (const acct of roster) {
    // ALL matching channels, not the first. An account can legitimately have two
    // — Othello has the real `othello-virio` alongside `virio-othello-`, which
    // HubSpot Breeze created and which holds only join events. Taking the first
    // match meant reading the empty one and reporting no activity. Latencies are
    // computed per channel and pooled afterwards, never by merging the message
    // streams, so a customer message in one channel can never be "answered" by a
    // Virio message in another.
    const chs = virioChannels.filter((c) => channelMatches(c.name, acct.company));
    // Exclude accounts with no Slack channel (email-only customers, or not yet
    // onboarded). They reappear automatically once a channel exists.
    if (!chs.length) { unmatched.push(acct.company); continue; }
    matched.push({ company: acct.company, channel: chs.map((c) => c.name).join(', ') });
    let latencies = [], bizLatencies = [];
    for (const ch of chs) {
      try {
        const msgs = (await channelHistory(ch.id, oldest, token))
          .filter((m) => !m.subtype && m.user) // drop joins / system / bot posts
          .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        for (const uid of [...new Set(msgs.map((m) => m.user))]) await teamOf(uid); // warm cache
        const isInternal = (m) => userTeam[m.user] === virioTeamId;

        // One clock per BURST of customer messages, not per message.
        //
        // Previously every customer message started its own clock and a single
        // reply stopped all of them, so a client who thinks out loud in five
        // messages charged the AM five latencies for one gap — and the earliest
        // was timed from the first message, so chatty accounts were penalised
        // hardest. Consecutive customer messages less than BURST_GAP_SECONDS
        // apart are now one prompt, timed from the first message in the burst,
        // which is when they actually started waiting. A genuine second question
        // hours later still starts its own clock.
        let i = 0;
        while (i < msgs.length) {
          if (isInternal(msgs[i])) { i++; continue; }
          let j = i;
          while (j < msgs.length && !isInternal(msgs[j])) j++;   // run of customer messages
          const reply = j < msgs.length ? msgs[j] : null;        // first Virio reply after it
          if (reply) {
            let burstStart = i;
            for (let k = i + 1; k <= j; k++) {
              const atEnd = k === j;
              const gap = atEnd ? Infinity : parseFloat(msgs[k].ts) - parseFloat(msgs[k - 1].ts);
              if (atEnd || gap > BURST_GAP_SECONDS) {
                const st = parseFloat(msgs[burstStart].ts), en = parseFloat(reply.ts);
                latencies.push(en - st);
                bizLatencies.push(businessSeconds(st, en));
                burstStart = k;
              }
            }
          }
          i = j;
        }
      } catch (e) { /* channel read failed — leave this channel out */ }
    }
    accounts.push({
      company: acct.company, am: acct.am, product: acct.product,
      median_seconds: median(latencies), mean_seconds: mean(latencies), sample: latencies.length,
      channel: chs.map((c) => c.name).join(', '),
    });
    (amLat[acct.am] = amLat[acct.am] || []).push(...latencies);
    (amBizLat[acct.am] = amBizLat[acct.am] || []).push(...bizLatencies);
    const pk = acct.product === 'EGC' ? 'EGC' : 'Full Service';
    amProdLat[acct.am] = amProdLat[acct.am] || {};
    (amProdLat[acct.am][pk] = amProdLat[acct.am][pk] || []).push(...latencies);
  }

  const ams = Object.keys(amLat).map((am) => {
    const accts = accounts.filter((a) => a.am === am);
    const mix = accts.reduce((m, a) => { const k = a.product === 'EGC' ? 'EGC' : 'FS'; m[k] = (m[k] || 0) + 1; return m; }, {});
    // Pooled stats per product so filtered views stay pooled (not median-of-medians).
    const byProduct = {};
    for (const p of ['EGC', 'Full Service']) {
      const lat = (amProdLat[am] && amProdLat[am][p]) || [];
      byProduct[p] = {
        accounts: accts.filter((a) => a.product === p).length,
        median_seconds: median(lat), mean_seconds: mean(lat), sample: lat.length,
      };
    }
    const biz = amBizLat[am] || [];
    return {
      am, accounts: accts.length, product_mix: mix,
      median_seconds: median(amLat[am]), mean_seconds: mean(amLat[am]), sample: amLat[am].length,
      median_business_seconds: median(biz), mean_business_seconds: mean(biz),
      by_product: byProduct,
    };
  });

  // Accounts with no channel are carried in the payload, not just dropped. A
  // silently missing row is exactly how the old matcher hid Othello for weeks:
  // the tab showed nothing wrong because the account simply was not there. Now
  // the tab names them, so "no channel" is a claim someone can check rather
  // than an absence nobody notices.
  const payload = {
    generated_at: new Date().toISOString(), window_days: WINDOW_DAYS, source: 'slack',
    roster_source: rosterSource, accounts, ams, unmatched,
  };

  const { getStore } = require('@netlify/blobs');
  await getStore('response-times').setJSON('latest', payload);

  return { payload, matched, unmatched };
}

module.exports = { computeAndStore, WINDOW_DAYS };
