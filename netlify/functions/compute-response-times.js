// Scheduled job: recompute CS response-time medians from Slack every hour and
// store them in Netlify Blobs. Dormant (204) until SLACK_BOT_TOKEN is set.
//
// See _response-times-core.js for the definitions and logic.
// Storage is Netlify Blobs only — Supabase is never touched.

const { computeAndStore } = require('./_response-times-core');

exports.config = { schedule: '17 * * * *' }; // hourly at :17

exports.handler = async function (event) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log('compute-response-times: SLACK_BOT_TOKEN not set — skipping (dormant).');
    return { statusCode: 204 };
  }
  const { connectLambda } = require('@netlify/blobs');
  if (typeof connectLambda === 'function') connectLambda(event);
  const { matched, unmatched } = await computeAndStore(token);
  console.log(`compute-response-times: matched ${matched.length} channels, ${unmatched.length} unmatched.`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, matched: matched.length, unmatched: unmatched.length }) };
};
