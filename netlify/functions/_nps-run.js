// The monthly NPS run, shared by the scheduled job and the manual trigger.
//
// Order of operations is deliberate. Every row is CLAIMED in Supabase as
// 'pending' before its email is attempted, so a run that dies half way leaves
// rows we can see and finish rather than re-sending to clients who already got
// one. A re-run only ever picks up rows that are still pending or absent.

const core = require('./_nps-core');

async function runMonth({ hsToken, period, dryRun }) {
  const audience = await core.buildAudience(hsToken, period);

  // What already exists for this period — the idempotency guard.
  const existing = await core.sbSelect(
    `nps_sends?select=id,hs_company_id,hs_contact_id,contact_email,contact_name,company_name,status,token&period=eq.${period}`
  );
  const seen = new Set(existing.map(r => `${r.hs_company_id}|${r.hs_contact_id || ''}`));

  const fresh = audience.filter(r => !seen.has(`${r.hs_company_id}|${r.hs_contact_id || ''}`));

  const summary = {
    period,
    dry_run: !!dryRun,
    companies: new Set(audience.map(r => r.hs_company_id)).size,
    to_send: audience.filter(r => r.status === 'pending').length,
    no_foc: audience.filter(r => r.status === 'skipped_no_foc').length,
    no_email: audience.filter(r => r.status === 'skipped_no_email').length,
    already_recorded: audience.length - fresh.length,
    sent: 0,
    failed: 0,
    errors: [],
  };

  if (dryRun) {
    summary.preview = audience.map(r => ({
      company: r.company_name, contact: r.contact_name, email: r.contact_email,
      status: r.status, product: r.product, am: r.am,
      already_recorded: seen.has(`${r.hs_company_id}|${r.hs_contact_id || ''}`),
    }));
    return summary;
  }

  // Claim every new row first (pending sends and skip records alike).
  if (fresh.length) await core.sbInsert('nps_sends', fresh);

  // Anything still pending for this period — new rows plus anything a previous
  // run claimed but never got out the door.
  const pending = await core.sbSelect(
    `nps_sends?select=id,contact_email,contact_name,token,company_name&period=eq.${period}&status=eq.pending`
  );

  for (const row of pending) {
    try {
      await core.sendEmail(row);
      await core.sbPatch(`nps_sends?id=eq.${row.id}`, { status: 'sent', sent_at: new Date().toISOString(), send_error: null });
      summary.sent++;
    } catch (e) {
      await core.sbPatch(`nps_sends?id=eq.${row.id}`, { status: 'failed', send_error: String(e.message || e).slice(0, 500) });
      summary.failed++;
      summary.errors.push(`${row.company_name} <${row.contact_email}>: ${e.message}`);
    }
  }
  return summary;
}

module.exports = { runMonth };
