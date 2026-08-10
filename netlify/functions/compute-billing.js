// Scheduled job: refresh the Forecasting renewal board's billing data from
// Measure every hour and store it in Netlify Blobs ('billing' store, 'latest').
// Dormant (204) until MEASURE_API_TOKEN is set. Needs HUBSPOT_TOKEN too (the
// roster/company names come from HubSpot so billing keys line up).
//
// See _measure-core.js for the fetch + matching logic. The reader (billing.js)
// falls back to the committed snapshot (_cs-billing.js) if this never runs or
// fails, so prod is never broken by a bad run.

const { computeAndStore } = require('./_measure-core');

exports.config = { schedule: '23 * * * *' }; // hourly at :23 (offset from the other jobs)

exports.handler = async function (event) {
  const measureToken = process.env.MEASURE_API_TOKEN;
  const hsToken = process.env.HUBSPOT_TOKEN;
  if (!measureToken) { console.log('compute-billing: MEASURE_API_TOKEN not set — skipping (dormant).'); return { statusCode: 204 }; }
  if (!hsToken) { console.log('compute-billing: HUBSPOT_TOKEN not set — skipping.'); return { statusCode: 204 }; }
  try {
    const r = await computeAndStore(event, hsToken, measureToken);
    console.log(`compute-billing: matched ${r.matched.length}/${r.matched.length + r.unmatched.length} accounts via ${r.subPath} (${r.subCount} subs, ${r.overdueCount} overdue). Unmatched: ${r.unmatched.join(', ') || 'none'}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, matched: r.matched.length, unmatched: r.unmatched.length }) };
  } catch (e) {
    console.log('compute-billing: failed —', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
