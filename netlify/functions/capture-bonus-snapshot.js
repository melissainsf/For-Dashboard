// Scheduled job: capture the quarterly bonus baseline at the start of each
// quarter (00:05 UTC on Jan 1 / Apr 1 / Jul 1 / Oct 1). Captures only if the
// quarter has no snapshot yet, so a late run never overwrites a good baseline.
//
// Fully automated — no human action required. Mirrors compute-response-times.js.
const { captureSnapshot } = require('./_bonus-snapshot-core');

exports.config = { schedule: '5 0 1 1,4,7,10 *' };

exports.handler = async function (event) {
  try {
    const { connectLambda } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const result = await captureSnapshot(event, { force: false });
    console.log('capture-bonus-snapshot:', JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error('capture-bonus-snapshot failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
