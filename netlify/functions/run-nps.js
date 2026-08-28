// Manual trigger / validator: GET /api/run-nps?key=<last 6 chars of HUBSPOT_TOKEN>
//
//   ?dry=1   — resolve the audience and report exactly who WOULD be emailed,
//              without writing a row or sending anything. Run this first.
//   (no dry) — do the real run for the current month. Safe to re-run: rows are
//              claimed per (period, company, contact), so nobody is emailed twice.
//   &period=YYYY-MM-01 — target a specific month instead of the current one.
//
// Gated on the HubSpot token's last 6 characters, matching run-billing, so
// client contact details are not exposed publicly.

const { runMonth } = require('./_nps-run');
const { periodOf } = require('./_nps-core');

exports.handler = async function (event) {
  const hsToken = process.env.HUBSPOT_TOKEN;
  const q = (event && event.queryStringParameters) || {};
  if (!hsToken) return json(500, { error: 'HUBSPOT_TOKEN not set' });
  if ((q.key || '') !== hsToken.slice(-6)) {
    return json(401, { error: 'unauthorized — key must be the last 6 characters of the HubSpot token' });
  }

  const dryRun = q.dry === '1' || q.dry === 'true';
  const period = /^\d{4}-\d{2}-01$/.test(q.period || '') ? q.period : periodOf();

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
