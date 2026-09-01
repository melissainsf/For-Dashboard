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
eq('two intervals', iv.length, 2);
eq('earliest interval reaches back forever', iv[0].from, -Infinity);
eq('first owner is David, mapped from "CSM 2"', iv[0].am, 'Unassigned'); // David has left -> Unassigned
eq('handover boundary', iv[1].from, T('2026-08-20T00:00:00Z'));
eq('current interval is open-ended', iv[1].to, Infinity);

console.log('\n── The actual complaint: a reply owed before the handover ──');
eq('reply on Aug 10 belongs to the previous owner',
   RT.ownerAt(iv, T('2026-08-10T12:00:00Z')), 'Unassigned');
eq('reply on Aug 25 belongs to Melissa',
   RT.ownerAt(iv, T('2026-08-25T12:00:00Z')), 'Melissa');
eq('a reply the very instant of handover belongs to the new owner',
   RT.ownerAt(iv, T('2026-08-20T00:00:00Z')), 'Melissa');
eq('a reply one second before handover does not',
   RT.ownerAt(iv, T('2026-08-20T00:00:00Z') - 1), 'Unassigned');
eq('a reply from before any recorded change goes to the earliest known owner',
   RT.ownerAt(iv, T('2026-01-01T00:00:00Z')), 'Unassigned');

console.log('\n── No history: behave exactly as before ──');
const flat = RT.ownerIntervals(null, 'Melissa');
eq('single interval', flat.length, 1);
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
eq('the inherited-from-the-start owner reports no handover date',
   RT.ownersInWindow(iv, from, to)[0].since, null);
eq('the new owner reports when they took it on',
   RT.ownersInWindow(iv, from, to)[1].since, '2026-08-20T00:00:00.000Z');

console.log('\n── AM label mapping still applies to history values ──');
eq('Max -> Maxwell', RT.amLabel('Max'), 'Maxwell');
eq('departed staff -> Unassigned', RT.amLabel('Former Employee'), 'Unassigned');
eq('blank -> Unassigned', RT.amLabel(null), 'Unassigned');

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
