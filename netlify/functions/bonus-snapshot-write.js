// Manual capture of the current quarter's bonus baseline (from the dashboard's
// "Capture baseline now" button). Capture-if-absent, so it's safe to call
// without a secret: it only ever SEEDS a missing baseline, never overwrites a
// good one. Re-baselining requires ?key=<last 6 chars of HUBSPOT_TOKEN>.
//
// POST /api/bonus-snapshot-write        -> capture current quarter if absent
// POST /api/bonus-snapshot-write?key=…  -> force re-capture (overwrite)
const { captureSnapshot } = require('./_bonus-snapshot-core');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return reply(500, { error: 'HUBSPOT_TOKEN not set' });

  const key = (event.queryStringParameters && event.queryStringParameters.key) || '';
  const force = key && key === token.slice(-6);

  try {
    const { connectLambda } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const result = await captureSnapshot(event, { force: !!force });
    return reply(200, result);
  } catch (e) {
    return reply(500, { error: e.message });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body)
  };
}
