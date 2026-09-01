// Manual trigger: GET /api/run-response-times?key=<last 6 chars of SLACK_BOT_TOKEN>
// Runs the response-time computation on demand (so we don't wait for the hourly
// job) and returns a debug summary. Gated by the last 6 characters of the bot
// token — so no separate env var is needed, and the customer data in the response
// isn't exposed publicly.
//
// This is a convenience/validation endpoint — safe to remove once the scheduled
// job is confirmed working.

const { computeAndStore } = require('./_response-times-core');

exports.handler = async function (event) {
  const token = process.env.SLACK_BOT_TOKEN;
  const key = (event && event.queryStringParameters && event.queryStringParameters.key) || '';

  if (!token) return json(500, { error: 'SLACK_BOT_TOKEN not set' });

  // Gating on the last 6 characters of the bot token saved an env var and cost
  // us the ability to actually run this: SLACK_BOT_TOKEN is stored as a Netlify
  // SECRET, and Netlify masks a secret permanently once set — the value cannot
  // be read back from the UI or the API. So the only way to get the key was to
  // go to the Slack app config, which is not something the person who needs
  // this endpoint can reach. NPS_JOB_SECRET is the internal job secret, already
  // set in every deploy context, and already used to gate the NPS run — accept
  // it here too. The token suffix still works for anyone who has it.
  const jobSecret = process.env.NPS_JOB_SECRET;
  const ok = (jobSecret && key === jobSecret) || key === token.slice(-6);
  if (!ok) return json(401, { error: 'unauthorized — pass NPS_JOB_SECRET as ?key=' });

  try {
    const { connectLambda } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const { payload, matched, unmatched } = await computeAndStore(token);
    // Summary for validation: per-account medians + which channels matched.
    return json(200, {
      ok: true,
      generated_at: payload.generated_at,
      reaction_acks: payload.reaction_acks,   // bursts answered with an emoji
      unattributed_replies: payload.unattributed_replies,
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
