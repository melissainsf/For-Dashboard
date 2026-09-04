/* Unit tests for the NPS SWEEP — the safety net that delivers rows a monthly
   run recorded but never sent.
   Run:  node nps-sweep.test.js
   No dependencies; Supabase and the mail transport are both stubbed. The case
   being pinned down is 2026-09-01: 37 sends attempted, all 37 rejected by
   Resend with "the virio.ai domain is not verified", and nothing said so until
   somebody looked three days later. */
const core = require('./netlify/functions/_nps-core.js');
const { sweepMonth } = require('./netlify/functions/_nps-run.js');

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`  ✗ FAIL: ${name}\n      expected ${e}, got ${a}`); }
}
const ok = (name, cond) => eq(name, !!cond, true);

const ROW = (n, status) => ({
  id: `row-${n}`, period: '2026-09-01', hs_company_id: String(n),
  company_name: `Co ${n}`, contact_email: `c${n}@example.com`,
  status: status || 'pending', token: `TOK${n}`,
});
// What Sept 1 actually left behind: rows marked failed, not pending.
const REJECTED = (n) => ROW(n, 'failed');

// Only the four calls that reach the outside world. buildAudience is NOT among
// them on purpose — a sweep that touched HubSpot would fail this file.
function stub(over) {
  const calls = [];
  const saved = {};
  const fakes = {
    buildAudience: async () => { calls.push(['hubspot']); return []; },
    pendingSends: async (period, incFailed) => { calls.push(['pending', period, incFailed]); return over.pending || []; },
    recordSends: async () => { calls.push(['record']); return []; },
    markSent: async (id, status, err) => { calls.push(['mark', id, status, err || null]); },
    sendEmail: async (row) => {
      calls.push(['send', row.contact_email]);
      if (over.throwOn && over.throwOn === row.contact_email) throw new Error('550 mailbox unavailable');
      if (over.throwAll) throw new Error(over.throwAll);
    },
  };
  for (const k of Object.keys(fakes)) { saved[k] = core[k]; core[k] = fakes[k]; }
  return { calls, restore: () => Object.assign(core, saved) };
}

(async () => {
  console.log('\n── The September case: every send REJECTED by the transport ──');
  let s = stub({ pending: [REJECTED(1), REJECTED(2), REJECTED(3)] });
  let out = await sweepMonth({ period: '2026-09-01' });
  eq('a month rejected wholesale is re-sent', out.sent, 3);
  eq('and counted as stranded', out.still_unsent, 3);
  eq('and identified as rejections, not stalled rows', out.were_rejected, 3);
  ok('HubSpot is never called — the whole run goes into email',
     !s.calls.some(c => c[0] === 'hubspot'));
  ok('and nothing new is recorded', !s.calls.some(c => c[0] === 'record'));
  eq('each send is promoted to sent', s.calls.filter(c => c[0] === 'mark').map(c => c[2]),
     ['sent', 'sent', 'sent']);
  s.restore();

  console.log('\n── When the monthly run worked, the sweep is a no-op ──');
  s = stub({ pending: [] });
  out = await sweepMonth({ period: '2026-09-01' });
  eq('nobody is emailed', [out.still_unsent, out.sent, out.failed], [0, 0, 0]);
  ok('not one send is attempted', !s.calls.some(c => c[0] === 'send'));
  s.restore();

  console.log('\n── It asks for rejected rows too ──');
  // The whole point. A sweep that only looked at 'pending' would have found
  // nothing on Sept 1 and left the month unsent — the rows were 'failed'.
  s = stub({ pending: [ROW(1)] });
  await sweepMonth({ period: '2026-09-01' });
  eq('include_failed is true', s.calls[0], ['pending', '2026-09-01', true]);
  s.restore();

  console.log('\n── A row that actually went out is never in the list ──');
  // Not a matter of filtering: nps_pending returns only pending and failed, so
  // a delivered row cannot reach the sweep at all. Stubbed the same way here.
  s = stub({ pending: [] });
  out = await sweepMonth({ period: '2026-09-01' });
  eq('nobody is emailed twice', out.sent, 0);
  s.restore();

  console.log('\n── One bad address does not strand the rest ──');
  s = stub({ pending: [ROW(1), ROW(2), ROW(3)], throwOn: 'c2@example.com' });
  out = await sweepMonth({ period: '2026-09-01' });
  eq('the other two still go', out.sent, 2);
  eq('the bad one is recorded as failed', out.failed, 1);
  ok('with the transport\'s reason kept',
     s.calls.some(c => c[0] === 'mark' && c[2] === 'failed' && String(c[3]).includes('550')));
  ok('and named in the summary', out.errors[0].includes('Co 2'));
  s.restore();

  console.log('\n── A dead transport fails every row rather than losing them ──');
  s = stub({ pending: [ROW(1), ROW(2)], throwAll: 'Invalid login: 535-5.7.8' });
  out = await sweepMonth({ period: '2026-09-01' });
  eq('both are marked failed, so &retry=1 can find them later', out.failed, 2);
  eq('and none is left claiming to have been sent', out.sent, 0);
  s.restore();

  console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
