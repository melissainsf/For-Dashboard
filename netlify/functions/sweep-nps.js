// Scheduled safety net for the monthly NPS send.
//
// send-nps runs at 13:00 UTC on the 1st. On 2026-09-01 it recorded all 37 rows
// and delivered none of them — the emails only went out when the manual trigger
// was run that evening, eight hours later. Nobody noticed until the reminder
// work went looking. A month's survey should not depend on somebody remembering
// to check.
//
// So this runs a few times after it and delivers whatever is still sitting
// unsent. It reads NOTHING from HubSpot: the audience is already recorded, and
// skipping that work means the whole invocation is spent on email — which is
// the half that failed. If send-nps worked, this finds nothing pending and
// sends to nobody, which is the normal case.
//
// The schedule lives in netlify.toml, not here — see the comment at the top of
// that file. The declaration below documents intent only.

const { sweepMonth } = require('./_nps-run');
const { periodOf, canSend, transportName } = require('./_nps-core');

exports.config = { schedule: '0 14,15,16 1 * *' }; // 1st, hourly after send-nps

exports.handler = async function () {
  if (!process.env.HUBSPOT_TOKEN) { console.log('sweep-nps: HUBSPOT_TOKEN not set — skipping.'); return { statusCode: 204 }; }
  if (!canSend()) { console.log('sweep-nps: no sending transport configured — skipping (dormant).'); return { statusCode: 204 }; }
  if (!process.env.NPS_JOB_SECRET) { console.log('sweep-nps: NPS_JOB_SECRET not set — skipping (dormant).'); return { statusCode: 204 }; }

  const period = periodOf();
  try {
    const s = await sweepMonth({ period });
    if (!s.still_pending) {
      console.log(`sweep-nps ${period}: nothing pending — send-nps did its job.`);
      return { statusCode: 200, body: JSON.stringify(s) };
    }
    console.log(`sweep-nps ${period} via ${transportName()}: ${s.still_pending} were still unsent — sent ${s.sent}, failed ${s.failed}.`);
    if (s.errors.length) console.log('sweep-nps errors: ' + s.errors.join(' | '));
    return { statusCode: 200, body: JSON.stringify(s) };
  } catch (e) {
    console.log('sweep-nps: failed —', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
