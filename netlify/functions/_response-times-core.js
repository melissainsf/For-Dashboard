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
//   - Reactions COUNT as a reply: an emoji from a teammate is often the entire
//     answer. Slack exposes no timestamp for one, so an acknowledged burst is
//     recorded (`reaction_acks`) and left out of the median rather than timed to
//     a later message, which would only ever invent a slower number. Real timing
//     needs a reaction_added event subscription.
//   - Threads: a reply in the thread under a customer message stops that clock.
//     conversations.history returns top-level messages only, so these were
//     invisible and every median was inflated. Only threads rooted at a CUSTOMER
//     message are fetched — ours cannot answer their question.
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

// Replies to one thread. Only ever called for a thread hanging off a CUSTOMER
// message — see the burst loop for why that keeps the call count sane.
async function threadReplies(channelId, parentTs, token) {
  const out = [];
  let cursor;
  do {
    const r = await slack('conversations.replies', {
      channel: channelId, ts: parentTs, limit: '200', ...(cursor ? { cursor } : {}),
    }, token);
    out.push(...(r.messages || []));
    cursor = r.has_more && r.response_metadata ? r.response_metadata.next_cursor : null;
  } while (cursor);
  // conversations.replies echoes the parent back as the first element.
  return out.filter((m) => m.ts !== parentTs);
}


// The clock rule, lifted out of the channel loop so it can be tested against
// hand-built conversations instead of a live Slack workspace.
//
// One clock per BURST of customer messages, not per message. Previously every
// customer message started its own clock and a single reply stopped all of
// them, so a client who thinks out loud in five messages charged the AM five
// latencies for one gap — and the earliest was timed from the first message,
// so chatty accounts were penalised hardest. Consecutive customer messages less
// than BURST_GAP_SECONDS apart are one prompt, timed from the first message in
// the burst, which is when they actually started waiting. A genuine second
// question hours later still starts its own clock.
//
// A burst is answered by whichever comes first: a reply in the thread hanging
// under one of its messages, or the next top-level post from our side. A burst
// a teammate reacted to is acknowledged and deliberately not timed.
//
// ctx: { isInternal, ackedByReaction, repliesTo, onAck }
async function burstEvents(msgs, ctx) {
  const { isInternal, ackedByReaction, repliesTo, onAck } = ctx;
  const events = [];
  let i = 0;
  while (i < msgs.length) {
    if (isInternal(msgs[i])) { i++; continue; }
    let j = i;
    while (j < msgs.length && !isInternal(msgs[j])) j++;   // run of customer messages
    const topLevelReply = j < msgs.length ? msgs[j] : null;

    let burstStart = i;
    for (let k = i + 1; k <= j; k++) {
      const atEnd = k === j;
      const gap = atEnd ? Infinity : parseFloat(msgs[k].ts) - parseFloat(msgs[k - 1].ts);
      if (!atEnd && gap <= BURST_GAP_SECONDS) continue;

      const burst = msgs.slice(burstStart, k);
      burstStart = k;
      if (!burst.length) continue;

      if (burst.some(ackedByReaction)) { onAck(); continue; }

      const st = parseFloat(burst[0].ts);
      const lastTs = parseFloat(burst[burst.length - 1].ts);

      // Whichever came first: a reply in the thread under one of these
      // messages, or the next top-level post from our side.
      let answer = topLevelReply ? parseFloat(topLevelReply.ts) : Infinity;
      for (const m of burst) {
        for (const r of await repliesTo(m)) {
          const rts = parseFloat(r.ts);
          if (isInternal(r) && rts >= lastTs && rts < answer) answer = rts;
          // A teammate can also just react inside the thread.
          if (ackedByReaction(r)) { answer = -1; break; }
        }
        if (answer === -1) break;
      }
      if (answer === -1) { onAck(); continue; }
      if (!isFinite(answer)) continue;               // genuinely unanswered

      events.push({ at: st, sec: answer - st, biz: businessSeconds(st, answer) });
    }
    i = j;
  }
  return events;
}

// Pull the customer list + Account Manager + Product LIVE from HubSpot each run,
// so the widgets always match HubSpot (no static drift). Falls back to the bundled
// snapshot (_cs-accounts.js) if HubSpot is unavailable.
// The Account Manager field. HubSpot's INTERNAL name for it is `csm` — the
// label shown in the CRM is "Account Manager", and it is the only property
// with that label (`csm_sentiment` / `hs_csm_sentiment` are a different
// field, and `hubspot_owner_id` is the HubSpot user, not the AM). Reading
// `csm` is reading Account Manager; the name is just legacy.
const AM_PROPERTY = 'csm';
// Two options store an internal value that differs from the label people see.
const AM_LABEL = { 'CSM 2': 'David', 'Max': 'Maxwell' };
// Off the AM roster -> "Unassigned". These are Account Manager option VALUES,
// not the labels ('CSM 2' is David). Mirrors FORMER_AM_VALUES in index.html —
// keep the two in sync.
const FORMER_AMS = new Set([
  'Yichen', 'Lakeisha', 'Emmett', 'Jacob',
  'CSM 2',            // David — left Virio
  'Millie',
  'Prentice',         // offered the role, never accepted; an account briefly
                      // pointed at him and the history still carries it
  'Former Employee',  // HubSpot's catch-all for departed staff
]);
function amLabel(amValue) {
  if (!amValue || FORMER_AMS.has(amValue)) return 'Unassigned';
  return AM_LABEL[amValue] || amValue;
}
// Account Manager values that name a SHARED book rather than one person. These
// own their accounts for the whole window — see ownerIntervals for why.
const SHARED_BOOKS = new Set(['EGC']);
// ── ACCOUNT OWNERSHIP OVER TIME ───────────────────────────────────
// An AM is only answerable for replies owed while they owned the account.
// Attributing the whole window to today's owner charges a handover to the
// person who inherited it: take an account off David on the 20th and his
// slow replies from the 1st-19th land on your median, which is backwards.
//
// HubSpot keeps the history of the Account Manager property, so we read it
// and give each account a timeline of owners. Every measured reply is then credited
// to whoever owned the account at the moment the customer asked.
//
// History comes back newest-first as [{value, timestamp}], where timestamp
// is when the property BECAME that value. Sorted oldest-first, entry i owns
// the account from its timestamp until entry i+1's (or now, for the last).
function ownerIntervals(history, currentAmValue) {
  // A shared book is the exception to the timeline, and deliberately so.
  //
  // 'EGC' is not a person taking an account over — it is the statement that no
  // individual is solo-accountable for it, because Eric, Emmett and Eng are all
  // in there. So the name HubSpot carried before the book was labelled is a
  // MISLABEL, not a predecessor: the account was already run this way, the CRM
  // just did not say so. Splitting the window at the relabel would charge that
  // person a month of replies for accounts they never solely owned, which is
  // the same unfairness the timeline was built to stop, arriving from the other
  // direction. Backdating it is a correction, not a rewrite of history.
  if (SHARED_BOOKS.has(currentAmValue)) {
    return [{ am: amLabel(currentAmValue), from: -Infinity, to: Infinity }];
  }
  const h = (history || [])
    .filter((e) => e && e.timestamp)
    .map((e) => ({ raw: e.value, am: amLabel(e.value), at: Date.parse(e.timestamp) / 1000 }))
    .filter((e) => !isNaN(e.at))
    .sort((a, b) => a.at - b.at);

  // Not every history entry is a handover, and treating them as if they were
  // is how an AM's work disappears from their own row.
  //
  // Leading blanks: if the field was empty until someone filled it in, that is
  // the CRM catching up, not a transfer from nobody. Crediting the replies
  // before it to "Unassigned" would delete real work from the dashboard, so
  // the first person actually named covers everything before them.
  let i = 0;
  while (i < h.length && !h[i].raw) i++;
  const named = h.slice(i);

  // Repeats: HubSpot writes a history entry on every save, including workflow
  // re-saves that set the same value. Same owner twice is not a handover.
  const seq = named.filter((e, k) => k === 0 || e.am !== named[k - 1].am);

  if (!seq.length) return [{ am: amLabel(currentAmValue), from: -Infinity, to: Infinity }];

  const out = seq.map((e, k) => ({
    am: e.am, from: e.at, to: k + 1 < seq.length ? seq[k + 1].at : Infinity,
  }));

  // Before the first recorded value, we do not know who owned the account.
  //
  // Stretching the earliest known owner back to the beginning of time is what
  // kept the original bug alive: when HubSpot's history records only the
  // assignment itself — "Melissa, Aug 20", with no entry for whoever held it
  // before — that rule charged Melissa with every reply owed before she took
  // the account, which is the exact complaint the timeline was meant to fix.
  //
  // `am: null` means unknown, and an unknown stretch is charged to nobody. The
  // account still reports its own median over the full window; only the per-AM
  // pools skip it, because there is no honest answer to whose it was.
  out.unshift({ am: null, from: -Infinity, to: seq[0].at });
  return out;
}
function ownerAt(intervals, ts) {
  if (!intervals || !intervals.length) return null;
  for (const iv of intervals) if (ts >= iv.from && ts < iv.to) return iv.am;
  return intervals[intervals.length - 1].am;
}
// Owners who held the account at any point inside the window, oldest first,
// each with the moment they took it on. Drives the "since <date>" chip.
function ownersInWindow(intervals, from, to) {
  return intervals
    .filter((iv) => iv.am && iv.from < to && iv.to > from)
    // `since` means "took it on during this window". An owner who already held
    // the account when the window opened reports null, so the table does not
    // put a "since <date>" chip on every long-standing account.
    .map((iv) => ({
      am: iv.am,
      since: iv.from > from ? new Date(iv.from * 1000).toISOString() : null,
    }));
}

// HubSpot's search endpoint cannot return property history, so pull the
// Account Manager history in a second pass. A failure here is not fatal: without history every account
// simply behaves as it did before, wholly owned by its current AM.
async function fetchOwnerHistory(hsToken, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/batch/read', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hsToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertiesWithHistory: [AM_PROPERTY], properties: ['name'],
        inputs: ids.slice(i, i + 100).map((id) => ({ id })),
      }),
    });
    if (!res.ok) throw new Error('HubSpot history ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    for (const r of (data.results || [])) {
      out[r.id] = (r.propertiesWithHistory && r.propertiesWithHistory[AM_PROPERTY]) || [];
    }
  }
  return out;
}

async function fetchRoster(hsToken) {
  const roster = [];
  let after;
  do {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      properties: ['name', AM_PROPERTY, 'product'], limit: 100, ...(after ? { after } : {}),
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
        id: c.id,
        company: name,
        am_value: c.properties[AM_PROPERTY],
        am: amLabel(c.properties[AM_PROPERTY]),
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

  // Owner timeline per account. Without it (snapshot roster, or the history
  // call failing) every account falls back to one owner for the whole window,
  // which is exactly the old behaviour.
  const windowFrom = Number(oldest), windowTo = Date.now() / 1000;
  let ownerSource = 'hubspot-history';
  try {
    const ids = roster.map((a) => a.id).filter(Boolean);
    const hist = (ids.length && process.env.HUBSPOT_TOKEN)
      ? await fetchOwnerHistory(process.env.HUBSPOT_TOKEN, ids) : {};
    if (!ids.length) ownerSource = 'current-only';
    for (const a of roster) a.owners = ownerIntervals(hist[a.id], a.am_value);
  } catch (e) {
    console.log('response-times: Account Manager history unavailable, attributing to current owner —', e.message);
    ownerSource = 'current-only';
    for (const a of roster) a.owners = ownerIntervals(null, a.am_value);
  }

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
  const amProdBiz = {};
  const amAccts = {};        // am -> Set of companies they owned any of the window for
  const handovers = [];
  let unattributed = 0;      // replies inside the window with no recorded owner
  let reactionAcks = 0;      // bursts a teammate answered with an emoji (untimeable)
  let threadFetches = 0;     // conversations.replies calls made this run
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
    let events = [];   // { at, sec, biz } — `at` is when the customer started waiting
    for (const ch of chs) {
      try {
        const msgs = (await channelHistory(ch.id, oldest, token))
          .filter((m) => !m.subtype && m.user) // drop joins / system / bot posts
          .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        const reactors = msgs.flatMap((m) => (m.reactions || []).flatMap((r) => r.users || []));
        // Thread-reply authors are resolved lazily below, as their threads load.
        for (const uid of [...new Set([...msgs.map((m) => m.user), ...reactors])]) await teamOf(uid); // warm cache
        const isInternal = (m) => userTeam[m.user] === virioTeamId;
        // An emoji from a teammate IS an answer. For plenty of messages it is
        // the whole answer -- "got it", "on it", "shipped" -- and treating it as
        // silence charges the AM for a gap the customer never experienced.
        //
        // Slack will not tell us WHEN it was added: conversations.history gives
        // reactions as {name, users, count} with no timestamp, and no API
        // returns one after the fact. So we can know the burst was acknowledged
        // but not how fast. Timing it to some later message would be inventing a
        // number, and inventing it always upward. We record the acknowledgement
        // and leave it out of the median instead -- the same rule the owner
        // timeline uses for a stretch with no recorded owner: known to exist,
        // not honestly measurable, charged to nobody.
        const ackedByReaction = (m) =>
          (m.reactions || []).some((r) => (r.users || []).some((u) => userTeam[u] === virioTeamId));

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
        // Virio replies IN THREAD as a matter of practice, and conversations.history
        // returns only top-level messages — so the answer to most questions was
        // invisible and the clock ran on to some unrelated later post, or never
        // stopped at all. Every median before this was inflated, some wildly.
        //
        // Fetching every thread in every channel would be 300-1200 extra Slack
        // calls at 50/min, far past any function timeout. We do not need them:
        // a thread rooted at one of OUR messages cannot answer a customer's
        // question, so only threads hanging off a CUSTOMER message matter. That
        // is a handful per channel per month.
        const threadCache = {};
        async function repliesTo(m) {
          if (!m.reply_count) return [];
          if (!(m.ts in threadCache)) {
            try { threadCache[m.ts] = await threadReplies(ch.id, m.ts, token); }
            catch (e) { threadCache[m.ts] = []; }
            threadFetches++;
            // MUST resolve these authors before isInternal() is asked about
            // them: an unknown user id is not equal to our team id, so an
            // unwarmed cache would read our own thread replies as customer
            // messages — the clock would never stop and the fix would make
            // the numbers worse than leaving threads out entirely.
            const ids = threadCache[m.ts].flatMap((r) => [
              r.user, ...(r.reactions || []).flatMap((x) => x.users || []),
            ]).filter(Boolean);
            for (const uid of [...new Set(ids)]) await teamOf(uid);
          }
          return threadCache[m.ts];
        }

        events.push(...await burstEvents(msgs, {
          isInternal, ackedByReaction, repliesTo, onAck: () => { reactionAcks++; },
        }));
      } catch (e) { /* channel read failed — leave this channel out */ }
    }
    const latencies = events.map((e) => e.sec);
    const pk = acct.product === 'EGC' ? 'EGC' : 'Full Service';
    const owners = ownersInWindow(acct.owners, windowFrom, windowTo);
    if (owners.length > 1) {
      handovers.push({ company: acct.company, owners: owners.map((o) => o.am) });
    }

    // Every account the AM owned part of the window counts towards their row,
    // even if it was quiet — otherwise a silent account vanishes from the count.
    for (const o of owners) (amAccts[o.am] = amAccts[o.am] || new Set()).add(acct.company);

    // Credit each measurement to whoever owned the account when the customer
    // started waiting, not to whoever owns it today.
    for (const e of events) {
      const who = ownerAt(acct.owners, e.at);
      // No recorded owner at that moment — do not guess, and do not default to
      // whoever holds the account today. That default was the bug.
      if (!who) { unattributed++; continue; }
      (amLat[who] = amLat[who] || []).push(e.sec);
      (amBizLat[who] = amBizLat[who] || []).push(e.biz);
      amProdLat[who] = amProdLat[who] || {};
      (amProdLat[who][pk] = amProdLat[who][pk] || []).push(e.sec);
      amProdBiz[who] = amProdBiz[who] || {};
      (amProdBiz[who][pk] = amProdBiz[who][pk] || []).push(e.biz);
    }
    for (const o of owners) { amLat[o.am] = amLat[o.am] || []; amBizLat[o.am] = amBizLat[o.am] || []; }

    // The current owner's own figure, so the per-customer table can show a
    // number the person named beside it is actually answerable for.
    const cur = owners.length ? owners[owners.length - 1] : { am: acct.am, since: null };
    const curEvents = events.filter((e) => ownerAt(acct.owners, e.at) === cur.am
                                        && (!cur.since || e.at >= Date.parse(cur.since) / 1000));
    const curLat = curEvents.map((e) => e.sec);
    const bizAll = events.map((e) => e.biz);
    const curBiz = curEvents.map((e) => e.biz);

    accounts.push({
      company: acct.company, am: acct.am, product: acct.product,
      median_seconds: median(latencies), mean_seconds: mean(latencies), sample: latencies.length,
      median_business_seconds: median(bizAll), mean_business_seconds: mean(bizAll),
      owners,
      owned_since: cur.since,
      current_owner_median_seconds: median(curLat),
      current_owner_median_business_seconds: median(curBiz),
      current_owner_sample: curLat.length,
      channel: chs.map((c) => c.name).join(', '),
    });
  }

  const ams = Object.keys(amLat).map((am) => {
    const owned = amAccts[am] || new Set();
    const accts = accounts.filter((a) => owned.has(a.company));
    const mix = accts.reduce((m, a) => { const k = a.product === 'EGC' ? 'EGC' : 'FS'; m[k] = (m[k] || 0) + 1; return m; }, {});
    // Pooled stats per product so filtered views stay pooled (not median-of-medians).
    const byProduct = {};
    for (const p of ['EGC', 'Full Service']) {
      const lat = (amProdLat[am] && amProdLat[am][p]) || [];
      const bz = (amProdBiz[am] && amProdBiz[am][p]) || [];
      byProduct[p] = {
        accounts: accts.filter((a) => a.product === p).length,
        median_seconds: median(lat), mean_seconds: mean(lat), sample: lat.length,
        median_business_seconds: median(bz), mean_business_seconds: mean(bz),
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
    roster_source: rosterSource, owner_source: ownerSource, handovers,
    business_hours: { start: DAY_START, end: DAY_END, tz: BUSINESS_TZ, weekends_counted: true },
    unattributed_replies: unattributed,
    reaction_acks: reactionAcks,
    thread_fetches: threadFetches,
    accounts, ams, unmatched,
  };

  const { getStore } = require('@netlify/blobs');
  await getStore('response-times').setJSON('latest', payload);

  return { payload, matched, unmatched };
}

// ownerIntervals/ownerAt/ownersInWindow are exported for the unit test in
// response-times-attribution.test.js — the attribution rule is the part worth
// pinning down, and it needs neither Slack nor HubSpot to exercise.
module.exports = { computeAndStore, WINDOW_DAYS, BURST_GAP_SECONDS, ownerIntervals, ownerAt, ownersInWindow, amLabel, businessSeconds, burstEvents };
