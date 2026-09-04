// Scheduled safety net for the monthly NPS send.
//
// send-nps runs at 13:00 UTC on the 1st. On 2026-09-01 it ran for 11.7 seconds,
// attempted all 37 sends, and had every one rejected by Resend with 403 "the
// virio.ai domain is not verified" — it had fallen back to a transport that
// cannot send as virio.ai at all. The month's surveys only went out that
// evening, because somebody ran the manual trigger with &retry=1. Nothing
// raised a hand in between.
//
// So this re-attempts anything still unsent — pending AND rejected, since a
// whole month can fail for one fixable reason. It reads no HubSpot: the
// audience is already recorded, so the whole invocation goes into sending.
// If send-nps worked, this finds nothing and emails nobody, which is normal.
//
// The transport fallback that caused it is now closed off in _nps-core: Resend
// is refused unless NPS_ALLOW_RESEND=1. This sweep is the second line, for
// everything that is not that.
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
    if (!s.still_unsent) {
      console.log(`sweep-nps ${period}: nothing pending — send-nps did its job.`);
      return { statusCode: 200, body: JSON.stringify(s) };
    }
    console.log(`sweep-nps ${period} via ${transportName()}: ${s.still_unsent} still unsent (${s.were_rejected} previously rejected) — sent ${s.sent}, failed ${s.failed}.`);
    if (s.errors.length) console.log('sweep-nps errors: ' + s.errors.join(' | '));
    return { statusCode: 200, body: JSON.stringify(s) };
  } catch (e) {
    console.log('sweep-nps: failed —', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
