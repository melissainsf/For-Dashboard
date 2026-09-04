/* Unit tests for the NPS REMINDER pass.
   Run:  node nps-reminder.test.js
   No dependencies, and nothing leaves the machine: Supabase and the mail
   transport are both stubbed. What is being pinned down here is the rule that
   decides who gets nudged, and the promise that nobody gets nudged twice. */
const core = require('./netlify/functions/_nps-core.js');
const { remindMonth } = require('./netlify/functions/_nps-run.js');

let passed = 0, failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passed++;
  else { failed++; console.error(`  ✗ FAIL: ${name}\n      expected ${e}, got ${a}`); }
}
function ok(name, cond) { eq(name, !!cond, true); }

const ROW = (over) => ({
  id: 'row-1', period: '2026-09-01', hs_company_id: '77', company_name: 'Acme',
  contact_email: 'sam@acme.com', contact_name: 'Sam Rivera', status: 'sent',
  token: 'TOKEN123', am: 'Max', product: 'Full Service',
  sent_at: '2026-09-01T17:43:00Z', responded_at: null, score: null,
  reminder_attempts: 0, reminder_error: null, ...over,
});

// Replace the four things that touch the outside world. Every call is recorded
// so the ORDER can be asserted — claiming after sending would be a double-send
// waiting for a crash.
function stub(over) {
  const calls = [];
  const saved = {};
  const fakes = {
    reminderAudience: async (period, incFailed) => { calls.push(['audience', period, incFailed]); return over.audience || []; },
    claimReminder: async (id, attempts) => { calls.push(['claim', id, attempts]); return over.claim === undefined ? true : over.claim; },
    markReminderFailed: async (id, err) => { calls.push(['failed', id, err]); },
    sendEmail: async (row, opts) => {
      calls.push(['send', row.contact_email, opts && opts.reminder]);
      if (over.sendThrows) throw new Error(over.sendThrows);
      return 'ok';
    },
  };
  for (const k of Object.keys(fakes)) { saved[k] = core[k]; core[k] = fakes[k]; }
  return { calls, restore: () => Object.assign(core, saved) };
}

(async () => {
  console.log('\n── The follow-up email is the same survey, asked again ──');
  const row = ROW();
  const survey = core.emailHtml(row);
  const reminder = core.emailHtml(row, { reminder: true });
  ok('the reminder carries the SAME token, so a late answer counts once',
     reminder.includes('t=TOKEN123&s=9') && survey.includes('t=TOKEN123&s=9'));
  eq('all eleven scoring links survive the reminder copy',
     (reminder.match(/nps-respond\?t=TOKEN123/g) || []).length, 11);
  ok('the opening line is different — it reads as a follow-up',
     !reminder.includes('One quick question for you') && survey.includes('One quick question for you'));
  ok('the question itself is untouched',
     reminder.includes('How likely are you to recommend Virio'));
  ok('the plain-text part follows the same variant',
     core.emailText(row, { reminder: true }).includes('asked this at the start of the month')
     && !core.emailText(row).includes('asked this at the start of the month'));

  console.log('\n── Subject ──');
  eq('the survey names the account', core.subjectFor(row), 'Virio x Acme Partnership');
  eq('the reminder is a Re: on that same subject, so clients thread it',
     core.subjectFor(row, { reminder: true }), 'Re: Virio x Acme Partnership');
  process.env.NPS_SUBJECT = 'Re: Virio x {company} Partnership';
  eq('a subject that already starts with Re: is not doubled',
     core.subjectFor(row, { reminder: true }), 'Re: Virio x Acme Partnership');
  delete process.env.NPS_SUBJECT;

  console.log('\n── A dry run touches nobody ──');
  let s = stub({ audience: [ROW(), ROW({ id: 'row-2', company_name: 'Bland', contact_email: 'jo@bland.ai' })] });
  let out = await remindMonth({ period: '2026-09-01', dryRun: true });
  eq('nothing is claimed and nothing is sent', s.calls.map(c => c[0]), ['audience']);
  eq('but it says exactly who would be nudged', out.preview.map(p => p.email), ['sam@acme.com', 'jo@bland.ai']);
  eq('and how many', out.to_send, 2);
  s.restore();

  console.log('\n── A real run claims each row BEFORE emailing it ──');
  s = stub({ audience: [ROW()] });
  out = await remindMonth({ period: '2026-09-01' });
  eq('claim comes first, then the send', s.calls.map(c => c[0]), ['audience', 'claim', 'send']);
  eq('the claim is a compare-and-set on the count the audience reported',
     s.calls[1], ['claim', 'row-1', 0]);
  eq('the send is flagged as a reminder', s.calls[2], ['send', 'sam@acme.com', true]);
  eq('counted as sent', [out.sent, out.failed, out.skipped_answered], [1, 0, 0]);
  s.restore();

  console.log('\n── Someone who answers mid-run is not nudged ──');
  s = stub({ audience: [ROW()], claim: false });
  out = await remindMonth({ period: '2026-09-01' });
  eq('a refused claim means no email at all', s.calls.map(c => c[0]), ['audience', 'claim']);
  eq('and it is reported, not silently dropped', [out.sent, out.skipped_answered], [0, 1]);
  s.restore();

  console.log('\n── A rejected reminder is recorded, not retried in place ──');
  s = stub({ audience: [ROW()], sendThrows: '454-4.7.0 Too many login attempts' });
  out = await remindMonth({ period: '2026-09-01' });
  eq('the failure is written to the row', s.calls[3][0], 'failed');
  ok('with the transport\'s own words', String(s.calls[3][2]).includes('Too many login attempts'));
  eq('and surfaced in the summary', out.failed, 1);
  ok('naming the account', out.errors[0].includes('Acme'));
  s.restore();

  console.log('\n── Retrying a failed reminder ──');
  s = stub({ audience: [ROW({ reminder_attempts: 1, reminder_error: 'boom' })] });
  out = await remindMonth({ period: '2026-09-01', retryFailed: true });
  eq('the flag reaches the audience query', s.calls[0], ['audience', '2026-09-01', true]);
  eq('and the claim compares against the attempt count already on the row',
     s.calls[1], ['claim', 'row-1', 1]);
  s.restore();

  console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
