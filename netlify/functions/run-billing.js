// Manual trigger / validator: GET /api/run-billing?key=<last 6 chars of MEASURE_API_TOKEN>
// Runs the Measure billing pull on demand (so we don't wait for the hourly job)
// and returns a debug summary — which endpoint path answered, how many accounts
// matched, and anything unmatched. Gated by the last 6 chars of the token so the
// customer billing data isn't exposed publicly.
//
// Safe to keep — it's how we confirm the live pull works after the token lands.

const { computeAndStore, MEASURE_BASE } = require('./_measure-core');

exports.handler = async function (event) {
  const measureToken = process.env.MEASURE_API_TOKEN;
  const hsToken = process.env.HUBSPOT_TOKEN;
  const key = (event && event.queryStringParameters && event.queryStringParameters.key) || '';

  if (!measureToken) return json(500, { error: 'MEASURE_API_TOKEN not set' });
  if (!hsToken) return json(500, { error: 'HUBSPOT_TOKEN not set' });
  if (key !== measureToken.slice(-6)) return json(401, { error: 'unauthorized — key must be the last 6 characters of the Measure API token' });

  try {
    const r = await computeAndStore(event, hsToken, measureToken);
    return json(200, {
      ok: true,
      base: MEASURE_BASE,
      subscriptions_path: r.subPath,
      invoices_path: r.invPath,
      subscriptions_seen: r.subCount,
      overdue_invoices_seen: r.overdueCount,
      matched_count: r.matched.length,
      unmatched: r.unmatched,
      generated_at: r.payload.generated_at,
      accounts: r.payload.accounts,
    });
  } catch (e) {
    return json(500, { error: e.message, base: MEASURE_BASE });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
