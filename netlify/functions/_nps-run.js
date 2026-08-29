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

  for (const row of pending) {
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

module.exports = { runMonth };
