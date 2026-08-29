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
//   &period=YYYY-MM-01 — target a specific month instead of the current one.
//
// Gated on NPS_JOB_SECRET — the same string the monthly job uses — so client
// contact details are not exposed publicly. (The HubSpot token's last 6 chars
// also work, matching run-billing, but Netlify only ever reveals the last 4 of
// a secret variable, which made that impractical to look up.)

const { runMonth } = require('./_nps-run');
const core = require('./_nps-core');
const { periodOf } = core;

// One real survey to one address. Uses the same code path as the monthly run —
// same email, same token, same scoring link — so a pass here means the whole
// chain works, not just that Resend accepted a message.
async function sendTest(to, period) {
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
    await core.sendEmail(saved);
    await core.markSent(saved.id, 'sent');
  } catch (e) {
    await core.markSent(saved.id, 'failed', String(e.message || e).slice(0, 500));
    throw e;
  }
  return {
    test: true,
    sent_to: to,
    from: process.env.NPS_FROM || 'Eric from Virio <eric@virio.ai>',
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

  const dryRun = q.dry === '1' || q.dry === 'true';
  const period = /^\d{4}-\d{2}-01$/.test(q.period || '') ? q.period : periodOf();
  const testTo = (q.test || '').trim();

  if (testTo) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) return json(400, { error: `"${testTo}" is not an email address` });
    if (!process.env.RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY not set — nothing can be sent yet.' });
    try {
      return json(200, { ok: true, ...(await sendTest(testTo, period)) });
    } catch (e) {
      return json(500, { error: e.message });
    }
  }

  if (!dryRun && !process.env.RESEND_API_KEY) return json(500, { error: 'RESEND_API_KEY not set — a real run would send nothing. Use ?dry=1 to preview.' });

  try {
    return json(200, { ok: true, ...(await runMonth({ hsToken, period, dryRun })) });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}
