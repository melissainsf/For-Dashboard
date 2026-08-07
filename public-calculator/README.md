# AM Quarterly Bonus Calculator — public build

A standalone, **candidate-facing** version of the Account Manager bonus calculator.
It contains the plan guide, the bonus matrix, the expansion-needed tables, and a
hands-on calculator — all driven by **manual input only**.

## What's different from the internal dashboard tab
- **No password / no login.** Anyone with the link can use it.
- **No company data.** It does **not** connect to HubSpot, does not list real
  AMs, and has no snapshots. Nothing about real customers, MRR, NRR, churn, or
  teammates is exposed. The only thing shipped is the plan *structure* (bands,
  multipliers, 6% cap, churn rule) — i.e. the offer you're describing to a
  candidate.
- **Manual entry.** The user picks a book band and types their own scenario
  (Quarterly NRR, expansion, team NRR, etc.).

## Files
- `index.html` — the page (self-contained; only external requests are Google Fonts).
- `bonus-calculator.js` — the plan math engine (identical to the internal one).
- `app.js` — the manual calculator UI logic.
- `netlify.toml` — static-site config.

## Deploy as a separate Netlify site
1. Netlify → **Add new site → Import an existing project** → pick this repo
   (`melissainsf/for-dashboard`).
2. Set **Base directory** to `public-calculator`.
3. Leave **Build command** empty; set **Publish directory** to `public-calculator`.
4. Deploy. Give the resulting URL to candidates.

Because it's a separate Netlify site pointed at this subfolder, it deploys and
versions independently from the internal dashboard.

## Keeping the plan in sync
If the plan changes in the internal tool, copy the updated `bonus-calculator.js`
(the `DEFAULT_CONFIG` block holds all bands, multipliers, the 6% cap, and the
churn rule) into this folder and redeploy.
