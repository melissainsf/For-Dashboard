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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
