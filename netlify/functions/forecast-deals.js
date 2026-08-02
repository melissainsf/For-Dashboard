// Virio CS Dashboard — manually-tracked deal numbers for ICP clients (read).
//
// Stored in the dashboard's own Netlify Blobs store, keyed by HubSpot company id.
// Only relevant for clients whose success_criteria is "Meetings booked with ICP";
// the dashboard decides who to show inputs for. Each entry:
//   { cc: closedCount, cv: closedValue, pc: pipelineCount, pv: pipelineValue }
//
// GET -> { map: { [companyId]: { cc, cv, pc, pv } } }
exports.handler = async function (event) {
  let map = {};
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('forecast-deals');
    const stored = await store.get('map', { type: 'json' });
    if (stored && typeof stored === 'object') map = stored;
  } catch (e) {
    console.log('forecast-deals: Blobs read failed —', e.message);
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
