// Billing snapshot from Measure — FALLBACK/SEED for the Forecasting renewal board.
//
// The renewal board shows each converted customer's next invoice date, the
// recurring invoice amount, and whether they're overdue (with a live days-late
// count). That billing data lives in Measure, not HubSpot.
//
// The deployed dashboard cannot reach Measure directly. Two ways to feed it:
//   1. LIVE (preferred): add a Measure API token to Netlify (MEASURE_API_TOKEN)
//      and a scheduled function writes the current billing map into the
//      'billing' Netlify Blobs store — same shape as `accounts` below. The
//      reader (billing.js) serves the blob when present.
//   2. SNAPSHOT (current): this file is a point-in-time snapshot pulled from
//      Measure. billing.js falls back to it when no blob exists, so the board
//      renders real numbers immediately. Refresh it by re-pulling from Measure.
//
// Days-overdue is intentionally NOT stored — the board computes it live from
// `overdue_since` (the earliest unpaid invoice's due date), so the count stays
// correct between refreshes. `overdue_since: null` means the account is current.
//
// Keys are the HubSpot company `name` used across the dashboard, so the board
// matches by name directly. Measure org names differ (e.g. "Preface Health,
// Inc." → Preface, "Disasters Inc." → TerraFort, "FREEPIK US, INC." → Magnific
// (Freepik)); that mapping is resolved here, at snapshot time.
//
//   next_invoice_date : ISO — when Measure next generates/sends the invoice
//   amount            : recurring invoice amount (USD, from the subscription MRR)
//   overdue_since     : ISO date of the earliest unpaid/overdue invoice, or null
//   overdue_amount    : total unpaid across overdue invoices (USD), or 0
//
// Last synced from Measure: 2026-08-10.
module.exports = {
  generated_at: '2026-08-10T00:00:00Z',
  source: 'measure-snapshot',
  currency: 'USD',
  accounts: {
    // Melissa
    'Bland':              { next_invoice_date: '2026-10-19T15:00:00Z', amount: 2173,  overdue_since: null,          overdue_amount: 0 },
    'Buzzlead':           { next_invoice_date: '2026-09-11T15:30:00Z', amount: 5432,  overdue_since: null,          overdue_amount: 0 },
    'Minimal':            { next_invoice_date: '2026-10-20T19:00:00Z', amount: 6518,  overdue_since: null,          overdue_amount: 0 },
    'Netlify':            { next_invoice_date: '2026-09-16T16:54:00Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'Othello':            { next_invoice_date: '2026-08-24T12:45:00Z', amount: 1629,  overdue_since: null,          overdue_amount: 0 },
    'Preface':            { next_invoice_date: '2026-12-01T00:53:00Z', amount: 6192,  overdue_since: null,          overdue_amount: 0 },
    'Trimble':            { next_invoice_date: '2026-08-21T21:47:00Z', amount: 15990, overdue_since: null,          overdue_amount: 0 },
    'VitalBenefits':      { next_invoice_date: '2026-09-04T02:17:00Z', amount: 3250,  overdue_since: '2026-08-04T02:17:00Z', overdue_amount: 3250 },
    // Maxwell
    'Axya':               { next_invoice_date: '2026-10-07T23:56:00Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'Flora':              { next_invoice_date: '2026-08-26T02:44:00Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'HustlePay':          { next_invoice_date: '2026-09-18T17:12:00Z', amount: 10320, overdue_since: null,          overdue_amount: 0 },
    'Metaview':           { next_invoice_date: '2026-10-19T21:17:00Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'Runpod':             { next_invoice_date: '2026-10-06T03:54:21Z', amount: 10211, overdue_since: null,          overdue_amount: 0 },
    'Sourcera':           { next_invoice_date: '2026-08-24T16:13:06Z', amount: 7061,  overdue_since: null,          overdue_amount: 0 },
    // David
    'Concord Visa':       { next_invoice_date: '2026-08-31T21:00:57Z', amount: 7966,  overdue_since: '2026-07-06T21:00:57Z', overdue_amount: 14667 },
    'Daylit':             { next_invoice_date: '2026-08-17T23:50:37Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'Fastshot':           { next_invoice_date: '2026-10-21T17:07:12Z', amount: 6518,  overdue_since: '2026-07-29T17:07:12Z', overdue_amount: 18000 },
    'Hume AI':            { next_invoice_date: '2026-10-27T08:56:00Z', amount: 3259,  overdue_since: '2026-08-04T08:56:00Z', overdue_amount: 9000 },
    'Hyperspell':         { next_invoice_date: '2026-08-25T21:17:00Z', amount: 9777,  overdue_since: null,          overdue_amount: 0 },
    'Magnific (Freepik)': { next_invoice_date: '2026-09-06T01:43:52Z', amount: 10320, overdue_since: null,          overdue_amount: 0 },
    'QWNTL Labs':         { next_invoice_date: '2026-08-31T17:22:30Z', amount: 16295, overdue_since: '2026-07-06T17:22:30Z', overdue_amount: 30000 },
    'TerraFort':          { next_invoice_date: '2026-09-02T18:01:00Z', amount: 6518,  overdue_since: null,          overdue_amount: 0 },
    // Marghi
    'Arceus':             { next_invoice_date: '2026-08-24T20:30:00Z', amount: 7500,  overdue_since: null,          overdue_amount: 0 },
    'Caspian':            { next_invoice_date: '2026-09-08T23:08:00Z', amount: 6518,  overdue_since: null,          overdue_amount: 0 },
    'Crescendo':          { next_invoice_date: '2026-11-02T18:09:00Z', amount: 6518,  overdue_since: '2026-08-10T18:09:00Z', overdue_amount: 18000 },
    'Futurify':           { next_invoice_date: '2026-08-31T21:06:00Z', amount: 8690,  overdue_since: null,          overdue_amount: 0 },
    'Percents':           { next_invoice_date: '2026-08-24T19:00:00Z', amount: 5432,  overdue_since: null,          overdue_amount: 0 },
    // Millie
    'Fergana Labs':       { next_invoice_date: '2026-08-12T16:35:00Z', amount: 9777,  overdue_since: null,          overdue_amount: 0 },
    'InnovoCommerce':     { next_invoice_date: '2026-08-20T01:57:30Z', amount: 543,   overdue_since: null,          overdue_amount: 0 },
    'Sybill':             { next_invoice_date: '2026-09-21T23:27:00Z', amount: 5432,  overdue_since: '2026-06-29T23:27:00Z', overdue_amount: 15000 },
    'Vendelux':           { next_invoice_date: '2026-10-07T06:15:51Z', amount: 6518,  overdue_since: null,          overdue_amount: 0 },
    'Watt Data':          { next_invoice_date: '2026-08-19T22:08:00Z', amount: 9234,  overdue_since: '2026-07-22T22:08:00Z', overdue_amount: 8500 },
    // Emily
    'Arga Labs':          { next_invoice_date: '2026-10-15T22:56:52Z', amount: 10320, overdue_since: null,          overdue_amount: 0 },
    'Goody':              { next_invoice_date: '2026-08-28T16:44:00Z', amount: 5432,  overdue_since: null,          overdue_amount: 0 },
    'Knopman Marks':      { next_invoice_date: '2026-10-03T02:49:00Z', amount: 8392,  overdue_since: null,          overdue_amount: 0 },
    // Vyrill has no active Measure subscription in the snapshot — board shows "—".
  },
};
