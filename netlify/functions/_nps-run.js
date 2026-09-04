// The monthly NPS run, shared by the scheduled job and the manual trigger.
//
// Every row is CLAIMED as 'pending' before its email is attempted, so a run that
// dies half way leaves rows we can see and finish rather than re-sending to
// clients who already got one. A re-run only picks up rows still pending, and
// the insert is ON CONFLICT DO NOTHING, so nobody is ever emailed twice.

const core = require('./_nps-core');

async function runMonth({ hsToken, period, dryRun, retryFailed }) {
  const audience = await core.buildAudience(hsToken, period);

  const summary = {
    period,
    dry_run: !!dryRun,
    companies: new Set(audience.map(r => r.hs_company_id)).size,
    to_send: audience.filter(r => r.status === 'pending').length,
    no_foc: audience.filter(r => r.status === 'skipped_no_foc').length,
    no_email: audience.filter(r => r.status === 'skipped_no_email').length,
    sent: 0,
    failed: 0,
    errors: [],
  };

  if (dryRun) {
    summary.preview = audience.map(r => ({
      company: r.company_name, contact: r.contact_name, email: r.contact_email,
      status: r.status, product: r.product, am: r.am,
    }));
    return summary;
  }

  // Claim the new rows. Anything already recorded for this period is skipped by
  // the unique index, so this is safe to run repeatedly.
  const inserted = await core.recordSends(audience);
  summary.newly_recorded = Array.isArray(inserted) ? inserted.length : 0;
  summary.already_recorded = audience.length - summary.newly_recorded;

  // New rows plus anything a previous run claimed but never got out the door.
  // With retryFailed, also pick up sends that were rejected — a whole month can
  // fail for one fixable reason (an unverified sending domain, an expired key),
  // and without this the only remedy would be waiting for next month.
  const pending = await core.pendingSends(period, !!retryFailed);
  summary.retrying_failed = !!retryFailed;

  await deliver(pending, summary);
  return summary;
}

// The send half, shared by the monthly run and the sweep that finishes what it
// started. One copy, so a fix to one is a fix to both.
async function deliver(rows, summary) {
  for (const row of rows) {
    try {
      await core.sendEmail(row);
      await core.markSent(row.id, 'sent');
      summary.sent++;
    } catch (e) {
      await core.markSent(row.id, 'failed', String(e.message || e).slice(0, 500));
      summary.failed++;
      summary.errors.push(`${row.company_name} <${row.contact_email}>: ${e.message}`);
    }
  }
  return summary;
}

// Deliver whatever the monthly run recorded but never got out the door.
//
// On 2026-09-01 send-nps ran for 11.7 seconds, attempted all 37 sends, and had
// every one rejected by Resend: 403, "the virio.ai domain is not verified". The
// month's surveys only went out that evening, when the manual trigger was run
// with &retry=1. A whole month failed for one fixable reason and nothing said so.
//
// So this picks up BOTH pending and failed rows. Pending alone would have been
// useless in September: a rejected send is recorded as failed, not left pending.
// Re-attempting a failed row is safe — the rejection means nothing was
// delivered, and nps_mark_sent flips failed to sent when it finally lands.
//
// It reads NOTHING from HubSpot. The audience is already recorded, so the whole
// invocation goes into sending, and it cannot re-resolve an audience or hit the
// dedup traps a second buildAudience carries (a merged contact id inserting a
// duplicate row, a renamed company surviving into a subject line).
//
// Safe to run as often as you like: it claims nothing new, and a row that was
// actually delivered is 'sent' and therefore not in the list.
async function sweepMonth({ period }) {
  const stuck = (await core.pendingSends(period, true)) || [];
  const summary = {
    period,
    sweep: true,
    still_unsent: stuck.length,
    were_rejected: stuck.filter(r => r.status === 'failed').length,
    sent: 0,
    failed: 0,
    errors: [],
  };
  await deliver(stuck, summary);
  return summary;
}

// The reminder pass. Reads nothing from HubSpot: the audience is the rows that
// were actually DELIVERED and have not been answered, and each nudge goes to the
// address stored on its own row, carrying that row's token.
//
// That is deliberate, and it has a cost worth knowing. A HubSpot fix made after
// the first send does not reach the reminder either — same reason a re-run does
// not re-read the CRM. Re-resolving the audience instead would risk nudging a
// DIFFERENT person than the one who holds the survey link, and scoring them
// against a row that was never sent to them. A wrong address is fixed by fixing
// the row, not by asking HubSpot again.
async function remindMonth({ period, dryRun, retryFailed }) {
  const audience = await core.reminderAudience(period, !!retryFailed) || [];

  const summary = {
    period,
    reminder: true,
    dry_run: !!dryRun,
    retrying_failed: !!retryFailed,
    companies: new Set(audience.map(r => r.hs_company_id)).size,
    to_send: audience.length,
    sent: 0,
    skipped_answered: 0,
    failed: 0,
    errors: [],
  };

  if (dryRun) {
    summary.preview = audience.map(r => ({
      company: r.company_name, contact: r.contact_name, email: r.contact_email,
      am: r.am, product: r.product,
      first_sent: r.sent_at, previous_reminders: r.reminder_attempts,
      previous_error: r.reminder_error || undefined,
    }));
    return summary;
  }

  for (const row of audience) {
    // Claim first, exactly as the first send does: nudging someone twice is
    // worse than missing them. The claim is refused if the answer landed while
    // this run was working through the queue — a real possibility, since the
    // list was built minutes earlier.
    let claimed;
    try {
      claimed = await core.claimReminder(row.id, row.reminder_attempts);
    } catch (e) {
      summary.failed++;
      summary.errors.push(`${row.company_name} <${row.contact_email}>: could not claim — ${e.message}`);
      continue;
    }
    if (!claimed) { summary.skipped_answered++; continue; }

    try {
      await core.sendEmail(row, { reminder: true });
      summary.sent++;
    } catch (e) {
      await core.markReminderFailed(row.id, String(e.message || e).slice(0, 500));
      summary.failed++;
      summary.errors.push(`${row.company_name} <${row.contact_email}>: ${e.message}`);
    }
  }
  return summary;
}

module.exports = { runMonth, sweepMonth, remindMonth };
