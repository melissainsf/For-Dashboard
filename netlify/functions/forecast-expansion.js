// Virio CS Dashboard — AM-entered "Target Expansion Close Date" (read).
//
// Stored in the dashboard's own Netlify Blobs store, keyed by HubSpot company id.
// Each entry is an ISO date string (YYYY-MM-DD) the account manager sets on the
// Forecasting renewal board.
//
// GET -> { map: { [companyId]: "YYYY-MM-DD" } }
exports.handler = async function (event) {
  let map = {};
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('forecast-expansion');
    const stored = await store.get('map', { type: 'json' });
    if (stored && typeof stored === 'object') map = stored;
  } catch (e) {
    console.log('forecast-expansion: Blobs read failed —', e.message);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ map }),
  };
};
