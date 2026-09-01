// Scheduled job: send the monthly NPS survey on the 1st.
//
// The schedule lives in netlify.toml, NOT here — this site deploys pre-bundled
// functions by direct API upload, so Netlify's bundler never reads
// `exports.config` and any schedule declared in source is silently ignored.
// (See the comment at the top of netlify.toml.) The declaration below is kept
// only as documentation of intent.
//
// Dormant (204) until a sending transport and the Supabase vars are set, so
// deploying this cannot email anyone before it is deliberately turned on.
// Transport is either Google (GMAIL_USER + GMAIL_APP_PASSWORD) or Resend
// (RESEND_API_KEY); see _nps-core for which wins.

const { runMonth } = require('./_nps-run');
const { periodOf, canSend, transportName } = require('./_nps-core');

exports.config = { schedule: '0 13 1 * *' }; // 1st of the month, 09:00 US/Eastern (EDT)

exports.handler = async function () {
  const hsToken = process.env.HUBSPOT_TOKEN;
  if (!hsToken) { console.log('send-nps: HUBSPOT_TOKEN not set — skipping.'); return { statusCode: 204 }; }
  if (!canSend()) {
    console.log('send-nps: no sending transport configured (need GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY) — skipping (dormant).');
    return { statusCode: 204 };
  }
  if (!process.env.NPS_JOB_SECRET) {
    console.log('send-nps: NPS_JOB_SECRET not set — skipping (dormant).');
    return { statusCode: 204 };
  }

  const period = periodOf();
  try {
    const s = await runMonth({ hsToken, period, dryRun: false });
    console.log(`send-nps ${period} via ${transportName()}: sent ${s.sent}, failed ${s.failed}, no FOC ${s.no_foc}, no email ${s.no_email}, across ${s.companies} companies.`);
    if (s.errors.length) console.log('send-nps errors: ' + s.errors.join(' | '));
    return { statusCode: 200, body: JSON.stringify(s) };
  } catch (e) {
    console.log('send-nps: failed —', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
