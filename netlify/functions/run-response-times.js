// Manual trigger: GET /api/run-response-times?key=<RT_TRIGGER_KEY>
// Runs the response-time computation on demand (so we don't wait for the hourly
// job) and returns a debug summary. Gated by RT_TRIGGER_KEY so the customer data
// in the response isn't exposed publicly.
//
// This is a convenience/validation endpoint — safe to remove once the scheduled
// job is confirmed working.

const { computeAndStore } = require('./_response-times-core');

exports.handler = async function (event) {
  const token = process.env.SLACK_BOT_TOKEN;
  const gate = process.env.RT_TRIGGER_KEY;
  const key = (event && event.queryStringParameters && event.queryStringParameters.key) || '';

  if (!token) return json(500, { error: 'SLACK_BOT_TOKEN not set' });
  if (!gate) return json(500, { error: 'RT_TRIGGER_KEY not set' });
  if (key !== gate) return json(401, { error: 'unauthorized' });

  try {
    const { payload, matched, unmatched } = await computeAndStore(token);
    // Summary for validation: per-account medians + which channels matched.
    return json(200, {
      ok: true,
      generated_at: payload.generated_at,
      matched_count: matched.length,
      unmatched: unmatched,
      accounts: payload.accounts.map((a) => ({
        company: a.company, am: a.am, channel: a.channel,
        median_seconds: a.median_seconds, sample: a.sample,
      })),
      ams: payload.ams,
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
