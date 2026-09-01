/* Unit tests for response-time OWNER ATTRIBUTION.
   Run:  node response-times-attribution.test.js
   No dependencies. Neither Slack nor HubSpot is touched — these exercise the
   rule that decides whose median a reply lands on. */
const RT = require('./netlify/functions/_response-times-core.js');

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`  ✗ FAIL: ${name}\n      expected ${e}, got ${a}`); }
}
const T = (iso) => Date.parse(iso) / 1000;

// HubSpot returns property history NEWEST FIRST.
const HANDOVER = [
  { value: 'Melissa', timestamp: '2026-08-20T00:00:00Z' },
  { value: 'CSM 2',   timestamp: '2026-05-01T00:00:00Z' },   // CSM 2 is David
];

console.log('\n── Owner timeline ──');
const iv = RT.ownerIntervals(HANDOVER, 'Melissa');
eq('unknown stretch + two recorded owners', iv.length, 3);
eq('the unknown stretch reaches back forever', iv[0].from, -Infinity);
eq('interval 0 is the unknown stretch before any record', iv[0].am, null);
eq('first RECORDED owner is David, mapped from "CSM 2"', iv[1].am, 'Unassigned'); // David has left
eq('handover boundary', iv[2].from, T('2026-08-20T00:00:00Z'));
eq('current interval is open-ended', iv[2].to, Infinity);

console.log('\n── The actual complaint: a reply owed before the handover ──');
eq('reply on Aug 10 belongs to the previous owner',
   RT.ownerAt(iv, T('2026-08-10T12:00:00Z')), 'Unassigned');
eq('reply on Aug 25 belongs to Melissa',
   RT.ownerAt(iv, T('2026-08-25T12:00:00Z')), 'Melissa');
eq('a reply the very instant of handover belongs to the new owner',
   RT.ownerAt(iv, T('2026-08-20T00:00:00Z')), 'Melissa');
eq('a reply one second before handover does not',
   RT.ownerAt(iv, T('2026-08-20T00:00:00Z') - 1), 'Unassigned');
eq('a reply from before any recorded change is charged to nobody',
   RT.ownerAt(iv, T('2026-01-01T00:00:00Z')), null);

console.log('\n── No history: behave exactly as before ──');
const flat = RT.ownerIntervals(null, 'Melissa');
eq('single interval, no unknown stretch', flat.length, 1);
eq('covers any timestamp', RT.ownerAt(flat, T('2020-01-01T00:00:00Z')), 'Melissa');
eq('empty history is the same as none', RT.ownerIntervals([], 'Max')[0].am, 'Maxwell');
eq('malformed entries are ignored, not crashed on',
   RT.ownerIntervals([{ value: 'Melissa' }, null, { value: 'x', timestamp: 'nonsense' }], 'Emily')[0].am, 'Emily');

console.log('\n── Owners inside the window ──');
const from = T('2026-08-02T00:00:00Z'), to = T('2026-09-01T00:00:00Z');
eq('a 30-day window spanning the handover names both owners',
   RT.ownersInWindow(iv, from, to).map(o => o.am), ['Unassigned', 'Melissa']);
eq('a window entirely after the handover names only Melissa',
   RT.ownersInWindow(iv, T('2026-08-21T00:00:00Z'), to).map(o => o.am), ['Melissa']);
eq('a window entirely before it names only the previous owner',
   RT.ownersInWindow(iv, T('2026-06-01T00:00:00Z'), T('2026-07-01T00:00:00Z')).map(o => o.am), ['Unassigned']);
eq('an owner who already held it when the window opened reports no date',
   RT.ownersInWindow(iv, from, to)[0].since, null);
eq('the new owner reports when they took it on',
   RT.ownersInWindow(iv, from, to)[1].since, '2026-08-20T00:00:00.000Z');

console.log('\n── AM label mapping still applies to history values ──');
eq('Max -> Maxwell', RT.amLabel('Max'), 'Maxwell');
eq('departed staff -> Unassigned', RT.amLabel('Former Employee'), 'Unassigned');
eq('blank -> Unassigned', RT.amLabel(null), 'Unassigned');

console.log('\n── Assigned mid-window, with no record of the previous owner ──');
// The case that kept the original bug alive: HubSpot records only the
// assignment, so there is no entry for whoever held the account before it.
const ONLY_ASSIGNMENT = [{ value: 'Melissa', timestamp: '2026-08-20T00:00:00Z' }];
const oa = RT.ownerIntervals(ONLY_ASSIGNMENT, 'Melissa');
eq('a reply owed BEFORE the assignment is charged to nobody',
   RT.ownerAt(oa, T('2026-08-05T00:00:00Z')), null);
eq('a reply owed after it is hers',
   RT.ownerAt(oa, T('2026-08-25T00:00:00Z')), 'Melissa');
eq('she is not listed as an owner of the stretch before she had it',
   RT.ownersInWindow(oa, T('2026-08-01T00:00:00Z'), T('2026-09-01T00:00:00Z')).map(o=>o.am), ['Melissa']);
eq('and the window reports when she took it on',
   RT.ownersInWindow(oa, T('2026-08-01T00:00:00Z'), T('2026-09-01T00:00:00Z'))[0].since,
   '2026-08-20T00:00:00.000Z');
// History that predates the window is unambiguous — no unknown stretch inside it.
const OLD = [{ value: 'Melissa', timestamp: '2026-01-05T00:00:00Z' }];
eq('an assignment predating the window covers the whole window',
   RT.ownerAt(RT.ownerIntervals(OLD,'Melissa'), T('2026-08-05T00:00:00Z')), 'Melissa');

console.log('\n── Entries that are NOT handovers ──');
// A workflow re-saving the same value writes history; it is not a transfer.
const REPEAT = [
  { value: 'Melissa', timestamp: '2026-08-30T00:00:00Z' },
  { value: 'Melissa', timestamp: '2026-08-15T00:00:00Z' },
  { value: 'Melissa', timestamp: '2026-06-01T00:00:00Z' },
];
eq('repeated saves of the same owner collapse to one recorded interval',
   RT.ownerIntervals(REPEAT, 'Melissa').length-1, 1);
eq('and that owner covers the whole window',
   RT.ownerAt(RT.ownerIntervals(REPEAT,'Melissa'), T('2026-08-05T00:00:00Z')), 'Melissa');

// A field that was blank until someone filled it in is the CRM catching up.
const BACKFILL = [
  { value: 'Melissa', timestamp: '2026-08-25T00:00:00Z' },
  { value: '',        timestamp: '2026-05-01T00:00:00Z' },
];
eq('a blank field is not evidence of an owner — charge nobody, do not guess',
   RT.ownerAt(RT.ownerIntervals(BACKFILL,'Melissa'), T('2026-08-05T00:00:00Z')), null);
eq('the blank is not treated as a recorded owner in the chain',
   RT.ownerIntervals(BACKFILL,'Melissa').filter(x=>x.am).map(x=>x.am), ['Melissa']);
eq('backfill collapses to a single recorded owner',
   RT.ownerIntervals(BACKFILL, 'Melissa').length-1, 1);

// A genuine handover still survives both guards.
const REAL = [
  { value: 'Melissa', timestamp: '2026-08-20T00:00:00Z' },
  { value: 'Melissa', timestamp: '2026-08-19T00:00:00Z' },  // no-op save just before
  { value: 'CSM 2',   timestamp: '2026-05-01T00:00:00Z' },
];
eq('a real handover is still two recorded owners', RT.ownerIntervals(REAL,'Melissa').length-1, 2);
// Collapsing keeps the EARLIEST of the repeats, so the handover is dated to
// when Melissa actually took it (the 19th), not to the later no-op save.
eq('the handover dates to the first save, not the no-op that followed',
   RT.ownerAt(RT.ownerIntervals(REAL,'Melissa'), T('2026-08-19T12:00:00Z')), 'Melissa');
eq('the day before it is still the previous owner',
   RT.ownerAt(RT.ownerIntervals(REAL,'Melissa'), T('2026-08-18T12:00:00Z')), 'Unassigned');

console.log('\n── Business-hours clock (the headline median) ──');
// 07:00–22:00 America/Los_Angeles. Weekends count; nights do not.
const B = RT.businessSeconds;
const h = (n) => Math.round(n / 3600 * 100) / 100;
eq('an hour inside the working day counts in full',
   h(B(T('2026-08-12T17:00:00Z'), T('2026-08-12T18:00:00Z'))), 1);      // 10:00->11:00 PT
eq('10pm PT to 7am PT next day counts as nothing',
   B(T('2026-08-13T05:00:00Z'), T('2026-08-13T14:00:00Z')), 0);          // 22:00 -> 07:00 PT
eq('a 10pm message answered at 8am costs one working hour, not nine',
   h(B(T('2026-08-13T04:30:00Z'), T('2026-08-13T15:00:00Z'))), 1.5);     // 21:30 -> 08:00 PT
eq('a full day is capped at the 15-hour window',
   h(B(T('2026-08-12T14:00:00Z'), T('2026-08-13T14:00:00Z'))), 15);      // 07:00 -> 07:00 PT
eq('end before start is zero, never negative',
   B(T('2026-08-12T18:00:00Z'), T('2026-08-12T17:00:00Z')), 0);
eq('weekends are counted — Virio works them',
   h(B(T('2026-08-15T17:00:00Z'), T('2026-08-15T19:00:00Z'))), 2);       // Saturday 10:00->12:00 PT

console.log('\n\u2500\u2500 Shared books (EGC) and non-AMs \u2500\u2500');
// The EGC book is run by Eric, Emmett and Eng together. When HubSpot was
// relabelled on Sep 1, the accounts had read "Melissa" for the whole window.
// Treating that as a handover would charge her a month of replies for accounts
// no one person owned -- so a shared book owns its whole timeline.
const WIN_FROM = T('2026-08-02T00:00:00Z'), WIN_TO = T('2026-09-01T23:59:00Z');
const relabelled = RT.ownerIntervals([
  { value: 'EGC',     timestamp: '2026-09-01T23:03:00Z' },
  { value: 'Melissa', timestamp: '2026-05-01T00:00:00Z' },
], 'EGC');
eq('a shared book owns one unbroken interval', relabelled.length, 1);
eq('...reaching back before the relabel', relabelled[0].from, -Infinity);
eq('a reply owed weeks before the relabel is EGC\'s, not Melissa\'s',
   RT.ownerAt(relabelled, T('2026-08-15T12:00:00Z')), 'EGC');
eq('Melissa does not appear on an EGC account at all',
   RT.ownersInWindow(relabelled, WIN_FROM, WIN_TO).map((o) => o.am), ['EGC']);

// The backdating must NOT leak into ordinary handovers between two people.
const realHandover = RT.ownerIntervals([
  { value: 'Emily',   timestamp: '2026-08-20T00:00:00Z' },
  { value: 'Melissa', timestamp: '2026-05-01T00:00:00Z' },
], 'Emily');
eq('a real handover still splits at the boundary',
   RT.ownersInWindow(realHandover, WIN_FROM, WIN_TO).map((o) => o.am), ['Melissa', 'Emily']);
eq('...the predecessor keeps her own replies',
   RT.ownerAt(realHandover, T('2026-08-15T12:00:00Z')), 'Melissa');
eq('...and the successor only owns from the handover on',
   RT.ownerAt(realHandover, T('2026-08-25T12:00:00Z')), 'Emily');

// Prentice was offered the role and never accepted; an account pointed at him
// briefly and the history kept it, which gave him his own AM row.
eq('Prentice maps to Unassigned', RT.amLabel('Prentice'), 'Unassigned');
eq('EGC survives amLabel as itself', RT.amLabel('EGC'), 'EGC');
const blip = RT.ownerIntervals([
  { value: 'Melissa',  timestamp: '2026-08-12T00:00:00Z' },
  { value: 'Prentice', timestamp: '2026-08-05T00:00:00Z' },
  { value: 'Melissa',  timestamp: '2026-06-01T00:00:00Z' },
], 'Melissa');
eq('a never-hired AM never gets a row of his own',
   RT.ownersInWindow(blip, WIN_FROM, WIN_TO).map((o) => o.am).includes('Prentice'), false);

console.log('\n── Reply detection: threads, reactions, bursts ──');
// Virio replies in-thread as a matter of practice. conversations.history only
// returns top-level messages, so those answers were invisible.
const VIRIO = 'T_VIRIO', CUST = 'T_CUST';
const TEAM = { AM: VIRIO, ENG: VIRIO, CLIENT: CUST, CLIENT2: CUST };
const M = (user, ts, extra) => Object.assign({ user, ts: String(ts) }, extra || {});
function ctxFor(threads) {
  return {
    isInternal: (m) => TEAM[m.user] === VIRIO,
    ackedByReaction: (m) =>
      (m.reactions || []).some((r) => (r.users || []).some((u) => TEAM[u] === VIRIO)),
    repliesTo: async (m) => (m.reply_count ? (threads[m.ts] || []) : []),
    onAck: () => { acks++; },
  };
}
let acks = 0;
const run = async (msgs, threads) => { acks = 0; const e = await RT.burstEvents(msgs, ctxFor(threads || {})); return { secs: e.map((x) => x.sec), acks }; };

(async () => {
  // The headline case: client asks, we answer in the thread 5 minutes later,
  // and nothing else is posted top-level for two days.
  eq('a thread reply stops the clock',
     (await run([M('CLIENT', 0, { reply_count: 1 }), M('AM', 172800)],
                { '0': [M('AM', 300)] })).secs, [300]);

  // Without the thread, that same conversation looked like a two-day wait.
  eq('...and without it the clock ran to the next top-level post',
     (await run([M('CLIENT', 0), M('AM', 172800)])).secs, [172800]);

  // A thread reply where NOTHING is posted top-level afterwards used to be
  // invisible entirely -- the burst was dropped, so a fast answer never counted.
  eq('a threaded answer with no later top-level post is now counted',
     (await run([M('CLIENT', 0, { reply_count: 1 })], { '0': [M('AM', 120)] })).secs, [120]);

  // A client replying inside their own thread is not an answer.
  eq('the client talking in their own thread does not stop the clock',
     (await run([M('CLIENT', 0, { reply_count: 1 }), M('AM', 900)],
                { '0': [M('CLIENT2', 60)] })).secs, [900]);

  // Emoji, top-level and in-thread.
  eq('a teammate emoji on the message is an acknowledgement, not a latency',
     (await run([M('CLIENT', 0, { reactions: [{ name: 'eyes', users: ['ENG'] }] }), M('AM', 259200)])).secs, []);
  eq('...and it is counted as an ack', acks, 1);
  eq('a teammate emoji inside the thread also acknowledges',
     (await run([M('CLIENT', 0, { reply_count: 1 }), M('AM', 259200)],
                { '0': [M('CLIENT2', 60, { reactions: [{ name: 'eyes', users: ['AM'] }] })] })).secs, []);
  eq('the client reacting to themselves is not an acknowledgement',
     (await run([M('CLIENT', 0, { reactions: [{ name: 'eyes', users: ['CLIENT'] }] }), M('AM', 600)])).secs, [600]);

  // Bursts still behave.
  eq('five messages inside the gap are one prompt, timed from the first',
     (await run([M('CLIENT', 0), M('CLIENT', 60), M('CLIENT', 120), M('AM', 300)])).secs, [300]);
  eq('a question hours later starts its own clock',
     (await run([M('CLIENT', 0), M('CLIENT', 7200), M('AM', 7500)])).secs, [7500, 300]);
  eq('an unanswered question is charged to nobody',
     (await run([M('CLIENT', 0)])).secs, []);

  // The earliest answer wins, whichever channel it came through.
  eq('a top-level reply beats a slower thread reply',
     (await run([M('CLIENT', 0, { reply_count: 1 }), M('AM', 100)], { '0': [M('AM', 500)] })).secs, [100]);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

