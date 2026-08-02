// Virio CS Dashboard — account health colors (read).
//
// Health is stored in the dashboard's OWN Netlify Blobs store, keyed by HubSpot
// company id. Lineage is no longer involved — AMs set colors in the dashboard and
// they persist here, shared across everyone.
//
// GET -> { map: { [hubspotCompanyId]: "red"|"yellow"|"green"|"blue" } }
exports.handler = async function (event) {
  let map = {};
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('account-health');
    const stored = await store.get('map', { type: 'json' });
    if (stored && typeof stored === 'object') map = stored;
  } catch (e) {
    // Blobs not available (e.g. local dev) or nothing stored yet — return empty.
    console.log('account-health: Blobs read failed —', e.message);
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
