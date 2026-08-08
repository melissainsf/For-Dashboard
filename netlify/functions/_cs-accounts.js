// Customer Success account roster — FALLBACK SNAPSHOT for the response-time widgets.
//
// The compute job (netlify/functions/_response-times-core.js) fetches this list
// LIVE from HubSpot on every run, so the widgets normally match HubSpot with no
// drift. This array is only used as a fallback when HubSpot is unavailable, so keep
// it in sync — it must mirror what fetchRoster() would produce.
//
// Scope: HubSpot companies where lifecycle stage = "Customer" (Virio's own record
// excluded). Last synced from HubSpot: 2026-08-08.
//
//   company : HubSpot company name (also used to match the `virio-<company>` Slack channel)
//   am      : Account Manager (csm) dropdown LABEL — HubSpot returns internal names,
//             so "CSM 2"->David and "Max"->Maxwell; former AMs -> "Unassigned".
//   product : "EGC" when HubSpot `product` === "EGC"; otherwise "Full Service".
module.exports = [
  // Melissa
  { company: 'Bland',              am: 'Melissa', product: 'EGC' },
  { company: 'Buzzlead',           am: 'Melissa', product: 'EGC' },
  { company: 'Minimal',            am: 'Melissa', product: 'Full Service' },
  { company: 'Netlify',            am: 'Melissa', product: 'Full Service' },
  { company: 'Othello',            am: 'Melissa', product: 'EGC' },
  { company: 'Preface',            am: 'Melissa', product: 'Full Service' },
  { company: 'Trimble',            am: 'Melissa', product: 'Full Service' },
  { company: 'VitalBenefits',      am: 'Melissa', product: 'EGC' },
  // Maxwell
  { company: 'Axya',               am: 'Maxwell', product: 'Full Service' },
  { company: 'Flora',              am: 'Maxwell', product: 'Full Service' },
  { company: 'HustlePay',          am: 'Maxwell', product: 'Full Service' },
  { company: 'Metaview',           am: 'Maxwell', product: 'Full Service' },
  { company: 'Runpod',             am: 'Maxwell', product: 'Full Service' },
  { company: 'Sourcera',           am: 'Maxwell', product: 'Full Service' },
  // David
  { company: 'Concord Visa',       am: 'David',   product: 'Full Service' },
  { company: 'Daylit',             am: 'David',   product: 'Full Service' },
  { company: 'Fastshot',           am: 'David',   product: 'Full Service' },
  { company: 'Hume AI',            am: 'David',   product: 'Full Service' },
  { company: 'Hyperspell',         am: 'David',   product: 'Full Service' },
  { company: 'Magnific (Freepik)', am: 'David',   product: 'Full Service' },
  { company: 'QWNTL Labs',         am: 'David',   product: 'Full Service' },
  { company: 'TerraFort',          am: 'David',   product: 'Full Service' },
  // Marghi
  { company: 'Arceus',             am: 'Marghi',  product: 'Full Service' },
  { company: 'Caspian',            am: 'Marghi',  product: 'Full Service' },
  { company: 'Crescendo',          am: 'Marghi',  product: 'Full Service' },
  { company: 'Futurify',           am: 'Marghi',  product: 'Full Service' },
  { company: 'Percents',           am: 'Marghi',  product: 'Full Service' },
  // Millie
  { company: 'Fergana Labs',       am: 'Millie',  product: 'Full Service' },
  { company: 'InnovoCommerce',     am: 'Millie',  product: 'Full Service' },
  { company: 'Sybill',             am: 'Millie',  product: 'Full Service' },
  { company: 'Vendelux',           am: 'Millie',  product: 'Full Service' },
  { company: 'Watt Data',          am: 'Millie',  product: 'Full Service' },
  // Emily
  { company: 'Arga Labs',          am: 'Emily',   product: 'Full Service' },
  { company: 'Goody',              am: 'Emily',   product: 'Full Service' },
  { company: 'Knopman Marks',      am: 'Emily',   product: 'Full Service' },
  { company: 'Vyrill',             am: 'Emily',   product: 'Full Service' },
];
