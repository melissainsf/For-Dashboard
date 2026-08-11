// GET /api/billing
// Serves per-account billing signals (next invoice date, recurring amount,
// overdue status) for the Forecasting renewal board.
//
// Reads the latest billing map from Netlify Blobs ('billing' store, 'latest'
// key) when a live Measure sync has populated it. Falls back to the committed
// snapshot (_cs-billing.js) so the board renders real numbers even before any
// live sync exists. See _cs-billing.js for the shape and refresh notes.
//
// Never touches Supabase or HubSpot.

const SNAPSHOT = require('./_cs-billing');

exports.handler = async function (event) {
  let payload = null;
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('billing');
    const stored = await store.get('latest', { type: 'json' });
    if (stored && stored.accounts && typeof stored.accounts === 'object') {
      payload = stored;
    }
  } catch (e) {
    // Blobs unavailable (local dev, or store not yet created) — use the snapshot.
    console.log('billing: Blobs read failed, using bundled snapshot —', e.message);
  }
  if (!payload) payload = SNAPSHOT;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload),
  };
};
