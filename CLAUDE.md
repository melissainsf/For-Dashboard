# Working notes

## Preferences

**Prefer the path Melissa can walk alone.** When something is blocked, lead with
the workaround that needs no one else, and keep the "ask a teammate / admin /
vendor" route as the fallback — named, but second. Waiting on another person is
a bottleneck for her, and a slightly less elegant solution she can ship today
beats a cleaner one that needs someone else's calendar.

Worked example: Resend refused to claim `virio.ai` (an old, untraceable account
still owns it). The reclaim path needed Workspace admin and Emmett. Adding
`mail.virio.ai` as its own domain sidesteps the claim entirely, needs only
Cloudflare access, and costs only the visible From address — with `NPS_REPLY_TO`
still pointing at `eric@virio.ai`, replies land in the real inbox anyway. That
was available from the start and should have been offered first.

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
- **NPS is gated on three env vars** — `HUBSPOT_TOKEN`, `NPS_JOB_SECRET`,
  `RESEND_API_KEY`. Any missing and `send-nps` returns 204 silently. Netlify env
  vars must be set for **all four deploy contexts**; one context is a common and
  invisible failure. `SUPABASE_URL` / `SUPABASE_ANON_KEY` must NOT be marked
  secret or the build fails.
- **The NPS audience follows the "Face of Content" association label**
  (USER_DEFINED, typeId 3), not the contact list. A label stranded on a
  duplicate contact silently emails the wrong address — this happened with Goody
  and is invisible to the dry run.
- Emmett declined the Supabase **service-role key**. Writes go through
  SECURITY DEFINER functions on the public anon key. Do not reintroduce it.
