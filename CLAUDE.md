# Working notes

## Preferences

**Prefer the path Melissa can walk alone.** When something is blocked, lead with
the workaround that needs no one else, and keep the "ask a teammate / admin /
vendor" route as the fallback — named, but second. Waiting on another person is
a bottleneck for her, and a slightly less elegant solution she can ship today
beats a cleaner one that needs someone else's calendar.

Worked example, including the part I got wrong. Resend refused to claim
`virio.ai` (an old, untraceable account still owns it). I proposed adding
`mail.virio.ai` instead — which sidesteps the claim, but needs Cloudflare DNS,
and **Melissa has no Cloudflare access**. Neither does Eric. So the "workaround"
still routed through Emmett, who had already been told he was done. That cost a
day and her patience.

The answer that needed nobody outside her reach: **drop Resend and send through
Google Workspace SMTP** with an app password from Eric — one message to the
person she finds easiest to ask, no DNS, no admin console, and the From address
is genuinely `eric@virio.ai` rather than a subdomain. Check who actually holds
the access a plan depends on *before* proposing it, not after.

**Verify before reporting.** Numbers on these dashboards drive how people are
judged. Check the live data or write a test rather than reasoning from the code
alone — several times the plausible explanation was wrong.

## The two dashboards — do not confuse them

| Dashboard | Repo | Netlify site |
| --- | --- | --- |
| Internal CS (EGC, response times, NPS, forecasting) | `melissainsf/For-Dashboard` | `viriodash.netlify.app` |
| Customer-facing (Netlify client) | `melissainsf/Netlify-Data-Tracking` | `viriodashboard.netlify.app` |

`For-Dashboard/netlify-data-tracking/` is a **stale copy** of the customer
dashboard that deploys nowhere. Do not edit it.

Neither site is reachable from a Claude Code session — the egress proxy returns
403 on `*.netlify.app`, so endpoints have to be run from Melissa's browser.

## Facts worth not re-deriving

- **HubSpot `csm` IS the "Account Manager" field.** That is its internal name;
  the CRM label is "Account Manager", and it is the only property with that
  label. `csm_sentiment` is unrelated; `hubspot_owner_id` is the HubSpot user.
  Two options store a value that differs from the label: `CSM 2` = David,
  `Max` = Maxwell.
- **Response times run on a working-hours clock** (07:00–22:00 PT, weekends
  counted — Virio works them). Raw 24/7 is kept and shown on hover only.
  Replies are credited to whoever owned the account at the time of the message;
  a stretch with no recorded owner is charged to nobody.
- **NPS needs `HUBSPOT_TOKEN`, `NPS_JOB_SECRET`, and a transport.** Any missing
  and `send-nps` returns 204 silently. The transport is `GMAIL_USER` +
  `GMAIL_APP_PASSWORD` (Eric's Workspace app password, sending as
  `eric@virio.ai`) or, failing that, `RESEND_API_KEY` — `canSend()` accepts
  either. Resend cannot send as `virio.ai`: the domain is unverified and claimed
  by an account nobody can identify, so Gmail SMTP is the live path. `virio.ai`
  has no SPF record; Gmail authenticates these on DKIM alone, which passes.
  Netlify env vars must be set for **all four deploy contexts**; one context is
  a common and invisible failure. `SUPABASE_URL` / `SUPABASE_ANON_KEY` must NOT
  be marked secret or the build fails.
- **The NPS audience follows the "Face of Content" association label**
  (USER_DEFINED, typeId 3), not the contact list. A label stranded on a
  duplicate contact silently emails the wrong address — this happened with
  Goody. The dry run does show the resolved address, so sweep its preview for
  free-provider domains (gmail/outlook/yahoo) before sending; nothing flags it
  for you.
- **Response times are Slack only.** There is no Teams/Graph integration and
  adding one is not practical: Knopman Marks talks to us in Microsoft Teams, but
  Melissa is a **guest in Knopman's tenant**, so those messages live in their
  directory and nothing authenticating as `@virio.ai` can read them (her Virio
  Teams account can see exactly one chat, a 1:1 with Maxwell). It would take an
  app consented in *Knopman's* tenant, or moving them to a Virio-hosted Teams
  shared channel. Trimble and Axya are email-only. All three are correctly
  unmeasured — the tab used to claim it covered Teams, which was never true.
- Emmett declined the Supabase **service-role key**. Writes go through
  SECURITY DEFINER functions on the public anon key. Do not reintroduce it.

## Running NPS for the month

The first run **snapshots** each account into `nps_sends` — name, email, product,
AM, MRR — frozen at that moment. That is deliberate: it stops a converted account
from rewriting the score it gave as a pilot. The cost is that **a HubSpot fix made
after rows are recorded never reaches the emails**, because `&retry=1` re-sends
the stored row and does not re-read HubSpot. Both Goody's address and Magnific's
name were corrected in the CRM and still would have gone out wrong.

So the order is: **dry run → fix HubSpot → delete any drifted rows → send.**

1. `?key=…&dry=1` — reads HubSpot live. Check every address and company name.
2. Fix whatever is wrong in HubSpot.
3. Diff the dry run against the stored rows for the period. Delete any row whose
   email or name drifted; the next run rebuilds it from HubSpot. Deleting is safe
   for rows that are `failed` with no `score` and no `responded_at` — no email
   ever carried their tokens.
4. `?key=…` to send. Add `&retry=1` **only** if a previous run left `failed`
   rows — `nps_pending` returns them only under that flag, so without it a
   re-run sends to nobody.

**What went wrong on 2026-09-01, so it is not re-derived.** `send-nps` fired on
time, ran 11.7s, attempted all 37 sends — and **Resend rejected every one**:
`403 The virio.ai domain is not verified`. It had fallen back to Resend because
`GMAIL_USER`/`GMAIL_APP_PASSWORD` were not in play for that run. The surveys only
went out that evening when the manual trigger was run with `&retry=1`, which
flips `failed` → `sent` and therefore **erased the evidence** — the rows now read
`sent`, which is why the failure looked from the database like "the job died
before sending". It did not. Read the function log, not the rows.

Two things now guard it:

- **Resend is refused as a transport** unless `NPS_ALLOW_RESEND=1`. It cannot
  send as `virio.ai`, so falling back to it is not a fallback, it is a silent
  month-long failure. With no usable transport the job is dormant and logs why.
- **`sweep-nps`** runs at 14:00, 15:00 and 16:00 UTC on the 1st and re-attempts
  everything still unsent — **pending and rejected both**, because a rejected
  month is recorded as `failed`, not `pending`. It reads no HubSpot, so the whole
  invocation goes into sending and it cannot hit the dedup traps below.
  `?key=…&sweep=1` is the manual equivalent, and the safest thing to click when
  rows exist but people were not emailed.

Two dedup traps when rows already exist for the period:

- The unique index is `(period, hs_company_id, contact_key)` where
  `contact_key = hs_contact_id`. A **merged contact gets a new id**, so the fresh
  audience inserts a second row while the stale one still retries — that is a
  double-send to two addresses, one of them wrong.
- An **unchanged contact id** means `ON CONFLICT DO NOTHING` skips the insert and
  the stale `company_name` survives into the subject line.

Test sends (`&test=you@virio.ai`) are recorded under company id `__TEST__`, which
`npsFilterRows` drops, so they never move a real number. A score only counts once
its row is `status='sent'`; `nps_mark_sent` flips `failed` → `sent` on retry.

## Reminding the people who did not answer

`?key=…&remind=1` nudges everyone whose survey was **delivered** and who has not
answered. It reads **nothing from HubSpot** — the audience is the stored rows,
and each nudge goes to the address on its own row with that row's token, so a
late answer lands on the send it belongs to and counts once. The corollary is
the same as `&retry=1`: a CRM fix made after the send does not reach the
reminder either. Fix the row, not HubSpot, if an address is wrong.

Nobody is nudged twice. `nps_claim_reminder` is a compare-and-set on
`reminder_attempts`, so a second run, or an answer that arrives mid-run, is
refused the claim. `&remind=1&retry=1` re-opens only reminders the transport
**rejected** (`reminder_error`), never ones that went out. `&remind=1&dry=1`
previews the list; `&remind=1&test=you@virio.ai` sends the follow-up copy to one
address. Same order as the monthly send: **dry run → send.**
