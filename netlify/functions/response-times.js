// GET /api/response-times
// Serves the response-time aggregates for the two CS widgets.
//
// Reads the latest computed snapshot from Netlify Blobs (written by
// compute-response-times.js). If nothing has been computed yet — or Blobs is
// unavailable (e.g. local dev) — it falls back to the seed roster with null
// medians so the widgets still render the real accounts/AMs/products.
//
// NOTE: This never touches Supabase. Storage is Netlify Blobs only.

const ACCOUNTS = require('./_cs-accounts');

function seedPayload() {
  const accounts = ACCOUNTS.map(a => ({
    company: a.company,
    am: a.am,
    product: a.product,
    median_seconds: null,
    sample: 0,
    channel: null,
  }));
  return { generated_at: null, window_days: 30, source: 'seed', accounts, ams: null };
}

exports.handler = async function (event) {
  let payload = null;
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    if (typeof connectLambda === 'function') connectLambda(event);
    const store = getStore('response-times');
    const stored = await store.get('latest', { type: 'json' });
    if (stored && Array.isArray(stored.accounts) && stored.accounts.length) {
      payload = stored;
    }
  } catch (e) {
    // Blobs not available (local dev, or store not yet created) — fall back to seed.
    console.log('response-times: Blobs read failed, using seed roster —', e.message);
  }
  if (!payload) payload = seedPayload();

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
