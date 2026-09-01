// NPS survey core — audience resolution, Supabase access, and the email itself.
//
// Shared by send-nps.js (the monthly job) and run-nps.js (manual trigger and
// dry-run preview). Deliberately dependency-free: this site deploys pre-bundled
// functions by direct API upload, so every call here is plain fetch.

const HS = 'https://api.hubapi.com';

// "Face of Content" is a USER_DEFINED company→contact association label in the
// virio.ai portal (typeId 3). We match on the LABEL, not the id, because a
// label's typeId is portal-specific and can be re-created; the name is what
// AMs actually set in HubSpot.
const FOC_LABEL = 'face of content';

const CHURNED_STAGE = '1271359806';

// ── HubSpot ────────────────────────────────────────────────────────────────
async function hs(token, path, body) {
  const res = await fetch(HS + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Product tier, mirroring tierOf() in index.html: EGC and nothing else is an EGC
// account; EGC alongside anything (or blank) is Full Service. Kept in sync by
// hand — if the dashboard's rule changes, change it here too.
function tierOf(product) {
  const t = String(product || '').split(';').map(v => v.trim()).filter(Boolean);
  return t.length > 0 && t.every(v => /^EGC$/i.test(v)) ? 'EGC' : 'Full Service';
}

// The survey audience is the ACTIVE book only. Churned accounts (lifecyclestage
// = CHURNED_STAGE) are deliberately excluded — surveying someone who just left
// measures the exit, not the relationship, and would drag a score that is meant
// to steer live accounts.
async function fetchActiveCompanies(token) {
  const out = [];
  let after;
  do {
    const page = await hs(token, '/crm/v3/objects/companies/search', {
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      properties: ['name', 'domain', 'product', 'vertical', 'stage', 'pilot_status', 'csm', 'mrr', 'lifecyclestage'],
      limit: 100,
      after,
    });
    out.push(...(page.results || []));
    after = page.paging && page.paging.next && page.paging.next.after;
  } while (after);

  return out
    // Virio's own record is a customer in HubSpot but is not a client.
    .filter(c => c.properties.domain !== 'virio.ai' && c.properties.name !== 'Virio')
    .map(c => ({
      id: c.id,
      name: c.properties.name || c.properties.domain || c.id,
      product: tierOf(c.properties.product),
      vertical: c.properties.vertical || null,
      stage: c.properties.stage || null,
      pilot_status: c.properties.pilot_status || null,
      am: c.properties.csm || null,
      mrr: c.properties.mrr == null || c.properties.mrr === '' ? null : Number(c.properties.mrr),
    }));
}

// Company id → [contact id] for every contact carrying the Face of Content label.
// An account can legitimately have several (Bland and Trimble both do), and each
// one gets their own survey — the score belongs to the person, not the logo.
async function fetchFocContactIds(token, companyIds) {
  const byCompany = {};
  for (let i = 0; i < companyIds.length; i += 100) {
    const batch = companyIds.slice(i, i + 100);
    const res = await hs(token, '/crm/v4/associations/companies/contacts/batch/read', {
      inputs: batch.map(id => ({ id })),
    });
    for (const row of res.results || []) {
      const from = row.from && row.from.id;
      if (!from) continue;
      const ids = (row.to || [])
        .filter(t => (t.associationTypes || []).some(a => String(a.label || '').trim().toLowerCase() === FOC_LABEL))
        .map(t => String(t.toObjectId));
      if (ids.length) byCompany[from] = ids;
    }
  }
  return byCompany;
}

async function fetchContacts(token, contactIds) {
  const byId = {};
  for (let i = 0; i < contactIds.length; i += 100) {
    const res = await hs(token, '/crm/v3/objects/contacts/batch/read', {
      properties: ['email', 'firstname', 'lastname'],
      inputs: contactIds.slice(i, i + 100).map(id => ({ id })),
    });
    for (const c of res.results || []) {
      const p = c.properties || {};
      byId[c.id] = {
        id: c.id,
        email: (p.email || '').trim() || null,
        name: [p.firstname, p.lastname].filter(Boolean).join(' ').trim() || null,
      };
    }
  }
  return byId;
}

// One row per intended survey. Accounts with no labelled FOC, and labelled FOCs
// with no email on the contact, still produce a row — that is what keeps the
// response-rate denominator honest and makes the coverage gap fixable.
async function buildAudience(token, period) {
  const companies = await fetchActiveCompanies(token);
  const focIds = await fetchFocContactIds(token, companies.map(c => c.id));
  const allContactIds = [...new Set(Object.values(focIds).flat())];
  const contacts = allContactIds.length ? await fetchContacts(token, allContactIds) : {};

  const rows = [];
  for (const co of companies) {
    const seg = {
      period,
      hs_company_id: co.id,
      company_name: co.name,
      product: co.product,
      vertical: co.vertical,
      stage: co.stage,
      pilot_status: co.pilot_status,
      am: co.am,
      mrr: co.mrr,
    };
    const ids = focIds[co.id] || [];
    if (!ids.length) {
      rows.push({ ...seg, status: 'skipped_no_foc' });
      continue;
    }
    for (const cid of ids) {
      const contact = contacts[cid];
      if (!contact || !contact.email) {
        // A labelled FOC with no email address is a HubSpot data gap, not a
        // missing FOC — reported separately so the fix is obvious. The contact
        // id is kept: it names who to fix, and it keeps two email-less FOCs at
        // one company from colliding on the (period, company, contact) index.
        rows.push({ ...seg, status: 'skipped_no_email', hs_contact_id: cid, contact_name: contact ? contact.name : null });
        continue;
      }
      rows.push({
        ...seg,
        status: 'pending',         // promoted to 'sent' once Resend accepts it
        hs_contact_id: contact.id,
        contact_email: contact.email,
        contact_name: contact.name,
        token: newToken(),
      });
    }
  }
  return rows;
}

// ── Supabase (PUBLIC anon key only) ────────────────────────────────────────
// Nothing here can read or write the database at large. Every call goes through
// a SECURITY DEFINER function that does exactly one thing: the respondent path
// can only touch its own row, and the job's functions are gated on a shared
// secret. There is deliberately no service-role key in this codebase.
// The project URL and anon key are PUBLIC — both already ship inside
// index.html, because the dashboard needs them in the browser. Defaulting to
// the committed values means the monthly job cannot be broken by a mistyped or
// screen-copied paste of a constant that is not a secret in the first place.
// An env var still overrides, but only if it is actually usable.
const SUPABASE_URL_DEFAULT = 'https://ylplirptcybuzxnecsgp.supabase.co';
const SUPABASE_ANON_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscGxpcnB0Y3lidXp4bmVjc2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE1MDAwNjcsImV4cCI6MjA2NzA3NjA2N30.H7BnhxTNvZ8WnByos5P84M2f8qhthIRlt_5Whkwt1wg';

// A value copied off a screen while masked carries bullets or ellipses, which
// throw an opaque error the moment they reach an HTTP header. Ignore those.
function usable(v) {
  return typeof v === 'string' && v.trim() !== '' && !/[^\x20-\x7E]/.test(v.trim());
}
function supabaseUrl()  { const v = process.env.SUPABASE_URL;      return usable(v) ? v.trim() : SUPABASE_URL_DEFAULT; }
function supabaseAnon() { const v = process.env.SUPABASE_ANON_KEY; return usable(v) ? v.trim() : SUPABASE_ANON_DEFAULT; }

async function rpc(fn, args) {
  const base = supabaseUrl();
  const key = supabaseAnon();
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${fn} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function jobSecret() {
  const s = process.env.NPS_JOB_SECRET;
  if (!s) throw new Error('NPS_JOB_SECRET not set');
  return s;
}

const recordSends = (rows)          => rpc('nps_record_sends', { p_secret: jobSecret(), p_rows: rows });
const pendingSends = (period, incFailed) => rpc('nps_pending', { p_secret: jobSecret(), p_period: period, p_include_failed: !!incFailed });
const markSent = (id, status, err)  => rpc('nps_mark_sent',    { p_secret: jobSecret(), p_id: id, p_status: status, p_error: err || null });
const submitResponse = (token, score, comment) =>
  rpc('nps_submit_response', { p_token: token, p_score: score == null ? null : score, p_comment: comment == null ? null : comment });

// ── Email ──────────────────────────────────────────────────────────────────
//
// Two ways out. Resend is the original: it needs a domain verified by DNS.
// Google is the fallback for when that DNS is not ours to change — the domain
// already authorises Google to send for it, which is how @virio.ai mail works
// today, so nothing needs adding anywhere.
//
// Google wins when GMAIL_USER and GMAIL_APP_PASSWORD are both set; otherwise
// Resend. Neither set and nothing sends, which is the dormant state.
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
// App passwords are shown as four blocks of four. People paste them that way,
// and SMTP rejects the spaces, so strip them rather than fail on a copy-paste.
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const useGmail = () => !!(GMAIL_USER && GMAIL_PASS);

// Over SMTP the From address must be the account that authenticated — Google
// rewrites or rejects anything else — so it is built from GMAIL_USER rather
// than read from NPS_FROM, which could silently disagree with it.
const FROM_NAME = process.env.NPS_FROM_NAME || 'Eric, CEO at Virio';
function fromHeader() {
  if (useGmail()) return `"${FROM_NAME.replace(/"/g, '')}" <${GMAIL_USER}>`;
  return process.env.NPS_FROM || 'Eric from Virio <eric@virio.ai>';
}
const REPLY_TO = process.env.NPS_REPLY_TO || 'eric@virio.ai';

function publicBase() {
  return (process.env.NPS_PUBLIC_URL || process.env.URL || '').replace(/\/$/, '');
}

// 0–10 as eleven one-click links. The score is recorded on the click itself, so a
// reply costs one tap — the open-text "why" is asked afterwards, on the landing
// page, where abandoning it still leaves us the number.
function scoreRow(token) {
  const base = publicBase();
  const cell = (n) => {
    return `<td style="padding:0 3px 0 0"><a href="${base}/api/nps-respond?t=${encodeURIComponent(token)}&s=${n}" `
      + `style="display:block;width:34px;height:34px;line-height:34px;text-align:center;background:#f3f4f6;`
      + `border:1px solid #d7dae0;border-radius:6px;color:#141414;font:600 14px/34px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
      + `text-decoration:none">${n}</a></td>`;
  };
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${
    Array.from({ length: 11 }, (_, n) => cell(n)).join('')}</tr></table>`;
}

// What each number means, in Melissa's words. Shared by the HTML and text
// parts so the two cannot drift.
const SCALE = [
  ['0–3',  'absolutely not'],
  ['4–6',  'probably not'],
  ['7–8',  'probably'],
  ['9',    'for sure'],
  ['10',   'shouting from the rooftops'],
];

function emailHtml(row) {
  const first = (row.contact_name || '').split(' ')[0];
  const hi = first ? `Hi ${escapeHtml(first)},` : 'Hi,';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:520px;margin:0 auto;padding:24px 20px;font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141414">
<p style="margin:0 0 14px">${hi}</p>
<p style="margin:0 0 14px">Eric here, CEO and Co-Founder at Virio. One quick question for you, really appreciate your help:</p>
<p style="margin:0 0 12px"><strong>How likely are you to recommend Virio to a friend or colleague?</strong></p>
${scoreRow(row.token)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:407px;margin:8px 0 18px">
${SCALE.map(([range, meaning]) => `<tr>
<td style="padding:1px 8px 1px 0;font:12px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#141414;white-space:nowrap"><strong>${range}</strong></td>
<td style="padding:1px 0;font:12px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8a8f98">${meaning}</td></tr>`).join('')}
</table>
<p style="margin:0 0 14px">If there&rsquo;s anything we can improve on, or if you have any additional feedback to share, just reply to this email and it comes straight to me.</p>
<p style="margin:0">Thanks,<br>Eric</p>
</div></body></html>`;
}

function emailText(row) {
  const first = (row.contact_name || '').split(' ')[0];
  const base = publicBase();
  return `${first ? `Hi ${first},` : 'Hi,'}

Eric here, CEO and Co-Founder at Virio. One quick question for you, really appreciate your help:

How likely are you to recommend Virio to a friend or colleague?

${SCALE.map(([r, m]) => `  ${r.padEnd(5)} ${m}`).join('\n')}

${Array.from({ length: 11 }, (_, n) => `${n}: ${base}/api/nps-respond?t=${row.token}&s=${n}`).join('\n')}

If there's anything we can improve on, or if you have any additional feedback to share, just reply to this email and it comes straight to me.

Thanks,
Eric`;
}

// The subject names the account, so it reads as being about their
// relationship rather than as a generic survey. NPS_SUBJECT overrides it and
// may use {company}; without a company name (which only happens on a test
// row) it falls back to something that still makes sense on its own.
function subjectFor(row) {
  const co = ((row && row.company_name) || '').trim();
  const tpl = process.env.NPS_SUBJECT
    || (co ? 'Virio x {company} Partnership' : 'Quick question — how are we doing?');
  return tpl.replace(/\{company\}/g, co);
}

let mailer = null;
function gmailTransport() {
  if (!mailer) {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
  }
  return mailer;
}

async function sendViaGmail(row) {
  const info = await gmailTransport().sendMail({
    from: fromHeader(),
    to: row.contact_email,
    replyTo: REPLY_TO,
    subject: subjectFor(row),
    html: emailHtml(row),
    text: emailText(row),
  });
  return JSON.stringify({ id: info.messageId, via: 'gmail' });
}

async function sendViaResend(row) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      from: fromHeader(),
      to: [row.contact_email],
      reply_to: REPLY_TO,
      subject: subjectFor(row),
      html: emailHtml(row),
      text: emailText(row),
      tags: [{ name: 'type', value: 'nps' }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

async function sendEmail(row) {
  if (useGmail()) return sendViaGmail(row);
  return sendViaResend(row);
}

// Is anything configured to send at all? Used by the job and the manual
// trigger so both report the same thing instead of naming Resend specifically.
function canSend() { return useGmail() || !!process.env.RESEND_API_KEY; }
function transportName() { return useGmail() ? 'gmail' : (process.env.RESEND_API_KEY ? 'resend' : 'none'); }

// ── misc ───────────────────────────────────────────────────────────────────
function newToken() {
  return require('crypto').randomBytes(24).toString('base64url');
}

function periodOf(date) {
  const d = date ? new Date(date) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = {
  canSend, transportName, fromHeader, subjectFor,
  FOC_LABEL, CHURNED_STAGE, usable, supabaseUrl, supabaseAnon,
  tierOf, fetchActiveCompanies, fetchFocContactIds, fetchContacts, buildAudience,
  recordSends, pendingSends, markSent, submitResponse,
  sendEmail, emailHtml, emailText, publicBase,
  newToken, periodOf, escapeHtml,
};
