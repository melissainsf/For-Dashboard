// Public NPS response endpoint. NO AUTH — respondents are clients, not Virio
// staff, so this runs on the Supabase service-role key rather than the
// dashboard's RLS policy, and every write is scoped to a single row by an
// unguessable per-survey token.
//
//   GET  /api/nps-respond?t=<token>&s=<0-10>   record the score, ask why
//   POST /api/nps-respond   (form-encoded t, comment)   record the comment
//
// The score is recorded on the click from the email itself, so abandoning the
// comment box still leaves us the number — the reason NPS is asked this way.

const { sbSelect, sbPatch, escapeHtml } = require('./_nps-core');

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'POST') return await handleComment(event);
    return await handleScore(event);
  } catch (e) {
    console.log('nps-respond: failed —', e.message);
    return page(500, 'Something went wrong',
      "We couldn't record that just now. Replying to Eric's email works just as well — it comes straight to him.");
  }
};

async function lookup(token) {
  if (!token) return null;
  const rows = await sbSelect(
    `nps_sends?select=id,score,comment,responded_at,status,contact_name&token=eq.${encodeURIComponent(token)}&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

async function handleScore(event) {
  const q = (event && event.queryStringParameters) || {};
  const row = await lookup(q.t);
  if (!row) return page(404, 'Link not found', 'This survey link has expired or was already replaced by a newer one.');
  if (row.status !== 'sent') return page(410, 'Link not active', 'This survey is no longer accepting responses.');

  const score = Number(q.s);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return page(400, 'Invalid score', 'That link was missing a score between 0 and 10.');
  }

  // A re-click changes the score (people do misclick on a phone), but
  // responded_at keeps the FIRST reply so response-time reporting stays honest.
  const patch = { score };
  if (!row.responded_at) patch.responded_at = new Date().toISOString();
  await sbPatch(`nps_sends?id=eq.${row.id}`, patch);

  return page(200, 'Thanks — got it.', null, commentForm(q.t, score, row.comment));
}

async function handleComment(event) {
  const body = new URLSearchParams(
    event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '')
  );
  const row = await lookup(body.get('t'));
  if (!row) return page(404, 'Link not found', 'This survey link has expired.');
  if (row.status !== 'sent') return page(410, 'Link not active', 'This survey is no longer accepting responses.');

  const comment = (body.get('comment') || '').trim().slice(0, 4000);
  await sbPatch(`nps_sends?id=eq.${row.id}`, { comment: comment || null });

  return page(200, 'Thank you.', 'That goes straight to Eric and your account team. If it needs a conversation, he will be in touch.');
}

// ── rendering ──────────────────────────────────────────────────────────────
function commentForm(token, score, existing) {
  const prompt = score >= 9
    ? "What's working best? It helps us do more of it."
    : score >= 7
      ? 'What would take us from here to a 9 or 10?'
      : "What's gone wrong? We would rather hear it plainly.";
  return `<p class="lede">You scored us <strong>${score}</strong>. One more, if you have ten seconds:</p>
<p class="q">${escapeHtml(prompt)}</p>
<form method="POST" action="/api/nps-respond">
  <input type="hidden" name="t" value="${escapeHtml(token)}">
  <textarea name="comment" rows="5" placeholder="Optional — but the most useful part."
    autofocus>${escapeHtml(existing || '')}</textarea>
  <button type="submit">Send</button>
</form>
<p class="foot">Or just close this tab — your score is already saved.</p>`;
}

function page(statusCode, title, lede, extra) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Virio</title>
<style>
  :root{--bg:#F5F3EE;--surface:#FFFFFF;--ink:#1A1916;--ink2:#5C5A55;--ink3:#9B9890;
        --border:rgba(26,25,22,0.10);--teal:#0F6E56;--radius:10px}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
        box-shadow:0 1px 3px rgba(26,25,22,0.06),0 4px 12px rgba(26,25,22,0.04);
        padding:32px;max-width:520px;width:100%}
  h1{margin:0 0 12px;font-size:22px;letter-spacing:-0.01em}
  p{margin:0 0 14px;color:var(--ink2)}
  .q{color:var(--ink);font-weight:600}
  .foot{font-size:13px;color:var(--ink3);margin:14px 0 0}
  textarea{width:100%;font:inherit;font-size:15px;color:var(--ink);background:var(--bg);
           border:1px solid var(--border);border-radius:6px;padding:10px 12px;resize:vertical}
  textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 2px rgba(15,110,86,0.15)}
  button{margin-top:12px;font:inherit;font-weight:600;font-size:14px;color:#fff;background:var(--teal);
         border:none;border-radius:6px;padding:10px 20px;cursor:pointer}
  button:hover{background:#0c5a46}
</style></head><body><div class="card">
<h1>${escapeHtml(title)}</h1>
${lede ? `<p>${escapeHtml(lede)}</p>` : ''}
${extra || ''}
</div></body></html>`,
  };
}
