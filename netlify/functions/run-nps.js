// Manual trigger / validator: GET /api/run-nps?key=<last 6 chars of HUBSPOT_TOKEN>
//
//   ?dry=1   — resolve the audience and report exactly who WOULD be emailed,
//              without writing a row or sending anything. Run this first.
//   ?test=you@virio.ai — send ONE real survey to that address and nobody else,
//              so the whole chain (Resend, the email, the scoring link, the
//              write, the tab) can be proved before a month's send goes out
//              unattended. Recorded under the reserved company id __TEST__,
//              which the NPS tab filters out of every metric.
//   (no dry) — do the real run for the current month. Safe to re-run: rows are
//              claimed per (period, company, contact), so nobody is emailed twice.
//   ?retry=1 — also re-attempt sends that previously FAILED, for when a whole
//              month was rejected for one fixable reason. Never re-sends to
//              anyone whose survey actually went out.
//   ?sweep=1 — deliver rows this period RECORDED but never sent, without
//              touching HubSpot. What to click if a run left people unsent: it
//              cannot insert a row, cannot re-resolve an audience, and cannot
//              email anyone whose survey already went. Same code path as the
//              scheduled sweep-nps.
//   ?remind=1 — send the FOLLOW-UP to everyone whose survey was delivered and
//              who has not answered. Same row, same token, same scoring links,
//              so a late answer counts once and lands on the send it belongs to.
//              Combine with ?dry=1 to see exactly who would be nudged first, and
//              with ?retry=1 to re-attempt reminders that were rejected. Nobody
//              is nudged twice: the row is claimed before its email goes out.
//   &period=YYYY-MM-01 — target a specific month instead of the current one.
//
// Gated on NPS_JOB_SECRET — the same string the monthly job uses — so client
// contact details are not exposed publicly. (The HubSpot token's last 6 chars
// also work, matching run-billing, but Netlify only ever reveals the last 4 of
// a secret variable, which made that impractical to look up.)

const { runMonth, sweepMonth, remindMonth } = require('./_nps-run');
const core = require('./_nps-core');
const { periodOf } = core;

// One real survey to one address. Uses the same code path as the monthly run —
// same email, same token, same scoring link — so a pass here means the whole
// chain works, not just that Resend accepted a message.
async function sendTest(to, period, reminder) {
  const row = {
    period,
    hs_company_id: '__TEST__',
    company_name: 'Test send (internal)',
    hs_contact_id: '__TEST__' + Date.now(),
    contact_email: to,
    contact_name: to.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    product: 'Full Service',
    vertical: null, stage: null, pilot_status: null, am: null, mrr: null,
    status: 'pending',
    token: core.newToken(),
  };
  const [saved] = (await core.recordSends([row])) || [];
  if (!saved) throw new Error('could not record the test row');
  try {
    await core.sendEmail(saved, { reminder });
    await core.markSent(saved.id, 'sent');
  } catch (e) {
    await core.markSent(saved.id, 'failed', String(e.message || e).slice(0, 500));
    throw e;
  }
  return {
    test: true,
    reminder: !!reminder,
    subject: core.subjectFor(saved, { reminder }),
    sent_to: to,
    via: core.transportName(),
    from: core.fromHeader(),
    scoring_link_example: `${core.publicBase()}/api/nps-respond?t=${saved.token}&s=9`,
    note: 'Recorded under company id __TEST__, which the NPS tab excludes from every metric. Delete the row when you are done, or leave it — it is invisible.',
  };
}

exports.handler = async function (event) {
  const hsToken = process.env.HUBSPOT_TOKEN;
  const q = (event && event.queryStringParameters) || {};
  if (!hsToken) return json(500, { error: 'HUBSPOT_TOKEN not set' });
  const key = q.key || '';
  const jobSecret = process.env.NPS_JOB_SECRET || '';
  const ok = (jobSecret && key === jobSecret) || key === hsToken.slice(-6);
  if (!ok) {
    return json(401, { error: 'unauthorized — key must be NPS_JOB_SECRET (or the last 6 characters of the HubSpot token)' });
  }

  // A value copied off a screen instead of with the Copy button can carry
  // masking characters (•, …) or stray whitespace. Those blow up as an opaque
  // "cannot convert argument to a ByteString" the moment they reach an HTTP
  // header, so name the offender here instead.
  const badVar = checkEnv();
  if (badVar) return json(500, { error: badVar });

  const dryRun = q.dry === '1' || q.dry === 'true';
  const remind = q.remind === '1' || q.remind === 'true';
  const sweep = q.sweep === '1' || q.sweep === 'true';
  const retryFailed = q.retry === '1' || q.retry === 'true';
  const period = /^\d{4}-\d{2}-01$/.test(q.period || '') ? q.period : periodOf();
  const testTo = (q.test || '').trim();

  if (testTo) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) return json(400, { error: `"${testTo}" is not an email address` });
    if (!core.canSend()) return json(500, { error: 'No sending transport configured — set GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY.' });
    try {
      // With ?remind=1 this sends the FOLLOW-UP copy to that one address, so
      // the reminder can be read before a month's worth of clients read it.
      return json(200, { ok: true, ...(await sendTest(testTo, period, remind)) });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (!dryRun && !core.canSend()) return json(500, { error: 'No sending transport configured — a real run would send nothing. Use ?dry=1 to preview.' });

  try {
    if (sweep) return json(200, { ok: true, ...(await sweepMonth({ period })) });
    if (remind) return json(200, { ok: true, ...(await remindMonth({ period, dryRun, retryFailed })) });
    return json(200, { ok: true, ...(await runMonth({ hsToken, period, dryRun, retryFailed })) });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

// Returns a human-readable complaint about the first unusable env var, or null.
function checkEnv() {
  // SUPABASE_URL / SUPABASE_ANON_KEY are omitted: they are public, they fall
  // back to the committed values, and a bad paste of them is now harmless.
  for (const name of ['HUBSPOT_TOKEN', 'NPS_JOB_SECRET', 'RESEND_API_KEY', 'NPS_FROM', 'GMAIL_USER']) {
    const v = process.env[name];
    if (!v) continue;
    const bad = [...v].find(c => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32);
    if (bad) {
      const at = [...v].findIndex(c => c === bad);
      return `${name} contains the character "${bad}" (code ${bad.charCodeAt(0)}) at position ${at}. `
        + 'That usually means the value was copied off the screen while partly masked, rather than with the Copy button. '
        + 'Re-copy it at the source and paste it again in Netlify.';
    }
    if (v !== v.trim()) return `${name} has leading or trailing whitespace. Re-paste it in Netlify without the spaces.`;
  }
  return null;
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
