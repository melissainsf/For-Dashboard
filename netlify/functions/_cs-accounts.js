// Customer Success account roster — FALLBACK SNAPSHOT for the response-time widgets.
//
// The compute job (netlify/functions/_response-times-core.js) fetches this list
// LIVE from HubSpot on every run, so the widgets normally match HubSpot with no
// drift. This array is only used when that call fails, and the payload records
// which source was used as `roster_source` — the Response Times tab shows a
// warning when it reads "snapshot", because a silent fallback to a stale roster
// is how an AM ends up owning accounts they gave up months ago.
//
// The EGC book moved off Melissa in this sync: Eric, Emmett and Eng are all
// deeply involved in those accounts, so they are no longer solo-managed and
// HubSpot now carries the shared 'EGC' Account Manager value on all seven.
// Magnific also lost its "(Freepik)" suffix in the CRM.
//
// Scope: HubSpot companies where lifecycle stage = "Customer" (Virio's own record
// excluded). Last synced from HubSpot: 2026-09-01.
//
//   company : HubSpot company name (also used to match the client Slack channel)
//   am      : Account Manager (csm) dropdown LABEL — HubSpot returns internal names,
//             so "Max"->Maxwell; anyone off the AM roster (incl. "CSM 2"/David,
//             Millie and HubSpot's own "Former Employee") -> "Unassigned".
//             'EGC' is a shared book, not a person — see CURRENT_AM_VALUES.
//   product : "EGC" when HubSpot `product` === "EGC" exactly; a multi-value like
//             "Full Service;Rev Share" (Goody, Sourcera, Arceus, Arga Labs)
//             counts as Full Service, matching fetchRoster().
module.exports = [
  // EGC
  { company: 'Bland',                   am: 'EGC',      product: 'EGC' },
  { company: 'Buzzlead',                am: 'EGC',      product: 'EGC' },
  { company: 'Hyperspell',              am: 'EGC',      product: 'EGC' },
  { company: 'InnovoCommerce',          am: 'EGC',      product: 'Full Service' },
  { company: 'Madison West Partners',   am: 'EGC',      product: 'EGC' },
  { company: 'Othello',                 am: 'EGC',      product: 'EGC' },
  { company: 'Thrad',                   am: 'EGC',      product: 'EGC' },
  // Melissa
  { company: 'Netlify',                 am: 'Melissa',  product: 'Full Service' },
  { company: 'Trimble',                 am: 'Melissa',  product: 'Full Service' },
  // Marghi
  { company: 'Caspian',                 am: 'Marghi',   product: 'Full Service' },
  { company: 'Concord Visa',            am: 'Marghi',   product: 'Full Service' },
  { company: 'Crescendo',               am: 'Marghi',   product: 'Full Service' },
  { company: 'Futurify',                am: 'Marghi',   product: 'Full Service' },
  { company: 'Metaview',                am: 'Marghi',   product: 'Full Service' },
  { company: 'Percents',                am: 'Marghi',   product: 'Full Service' },
  // Maxwell
  { company: 'Axya',                    am: 'Maxwell',  product: 'Full Service' },
  { company: 'Flora',                   am: 'Maxwell',  product: 'Full Service' },
  { company: 'HustlePay',               am: 'Maxwell',  product: 'Full Service' },
  { company: 'Runpod',                  am: 'Maxwell',  product: 'Full Service' },
  { company: 'Sourcera',                am: 'Maxwell',  product: 'Full Service' },
  { company: 'TerraFort',               am: 'Maxwell',  product: 'Full Service' },
  // Emily
  { company: 'Arga Labs',               am: 'Emily',    product: 'Full Service' },
  { company: 'Goody',                   am: 'Emily',    product: 'Full Service' },
  { company: 'Knopman Marks',           am: 'Emily',    product: 'Full Service' },
  { company: 'Magnific',                am: 'Emily',    product: 'Full Service' },
  { company: 'Minimal',                 am: 'Emily',    product: 'Full Service' },
  { company: 'Preface',                 am: 'Emily',    product: 'Full Service' },
  // Daniel
  { company: 'Arceus',                  am: 'Daniel',   product: 'Full Service' },
  { company: 'Daylit',                  am: 'Daniel',   product: 'Full Service' },
  { company: 'Fergana Labs',            am: 'Daniel',   product: 'Full Service' },
  { company: 'Vendelux',                am: 'Daniel',   product: 'Full Service' },
  { company: 'Watt',                    am: 'Daniel',   product: 'Full Service' },
];
