/* Unit tests for the NPS SWEEP — the safety net that delivers rows a monthly
   run recorded but never sent.
   Run:  node nps-sweep.test.js
   No dependencies; Supabase and the mail transport are both stubbed. The case
   being pinned down is 2026-09-01: 37 rows written, 0 emails delivered. */
const core = require('./netlify/functions/_nps-core.js');
const { sweepMonth } = require('./netlify/functions/_nps-run.js');

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`  ✗ FAIL: ${name}\n      expected ${e}, got ${a}`); }
}
const ok = (name, cond) => eq(name, !!cond, true);

const ROW = (n) => ({
  id: `row-${n}`, period: '2026-09-01', hs_company_id: String(n),
  company_name: `Co ${n}`, contact_email: `c${n}@example.com`,
  status: 'pending', token: `TOK${n}`,
});

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
  console.log('\n── The September case: rows recorded, nothing delivered ──');
  let s = stub({ pending: [ROW(1), ROW(2), ROW(3)] });
  let out = await sweepMonth({ period: '2026-09-01' });
  eq('it sends every row the monthly run left behind', out.sent, 3);
  eq('and says how many were stranded', out.still_pending, 3);
  ok('HubSpot is never called — the whole run goes into email',
     !s.calls.some(c => c[0] === 'hubspot'));
  ok('and nothing new is recorded', !s.calls.some(c => c[0] === 'record'));
  eq('each send is promoted to sent', s.calls.filter(c => c[0] === 'mark').map(c => c[2]),
     ['sent', 'sent', 'sent']);
  s.restore();

  console.log('\n── When the monthly run worked, the sweep is a no-op ──');
  s = stub({ pending: [] });
  out = await sweepMonth({ period: '2026-09-01' });
  eq('nobody is emailed', [out.still_pending, out.sent, out.failed], [0, 0, 0]);
  ok('not one send is attempted', !s.calls.some(c => c[0] === 'send'));
  s.restore();

  console.log('\n── It asks only for PENDING rows, never failed ones ──');
  // Re-sending a row that a transport rejected is a decision for &retry=1, not
  // something a job should do unattended three times an hour.
  s = stub({ pending: [ROW(1)] });
  await sweepMonth({ period: '2026-09-01' });
  eq('include_failed is false', s.calls[0], ['pending', '2026-09-01', false]);
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
