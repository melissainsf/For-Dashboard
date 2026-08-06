// Read all stored quarterly bonus snapshots for the calculator's prefill.
//
// GET -> { snapshots: { "2026-Q3": { quarter, captured_at, accounts: {…} }, … } }
const { readSnapshots } = require('./_bonus-snapshot-core');

exports.handler = async function (event) {
  let snapshots = {};
  try {
    snapshots = await readSnapshots(event);
  } catch (e) {
    // Blobs unavailable (e.g. local dev) or nothing stored yet — return empty.
    console.log('bonus-snapshots read failed —', e.message);
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ snapshots })
  };
};
