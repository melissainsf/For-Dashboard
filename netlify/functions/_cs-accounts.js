// Customer Success account roster — FALLBACK SNAPSHOT for the response-time widgets.
//
// The compute job (netlify/functions/_response-times-core.js) fetches this list
// LIVE from HubSpot on every run, so the widgets normally match HubSpot with no
// drift. This array is only used as a fallback when HubSpot is unavailable, so keep
// it in sync — it must mirror what fetchRoster() would produce.
//
// Scope: HubSpot companies where lifecycle stage = "Customer" (Virio's own record
// excluded). Last synced from HubSpot: 2026-08-24.
//
//   company : HubSpot company name (also used to match the `virio-<company>` Slack channel)
//   am      : Account Manager (csm) dropdown LABEL — HubSpot returns internal names,
//             so "Max"->Maxwell; anyone off the AM roster (incl. "CSM 2"/David,
//             Millie and HubSpot's own "Former Employee") -> "Unassigned".
//   product : "EGC" when HubSpot `product` === "EGC"; otherwise "Full Service".
module.exports = [
  // Melissa
  { company: 'Bland',                am: 'Melissa',   product: 'EGC' },
  { company: 'Buzzlead',             am: 'Melissa',   product: 'EGC' },
  { company: 'InnovoCommerce',       am: 'Melissa',   product: 'Full Service' },
  { company: 'Netlify',              am: 'Melissa',   product: 'Full Service' },
  { company: 'Othello',              am: 'Melissa',   product: 'EGC' },
  { company: 'Trimble',              am: 'Melissa',   product: 'Full Service' },
  { company: 'VitalBenefits',        am: 'Melissa',   product: 'EGC' },
  // Marghi
  { company: 'Caspian',              am: 'Marghi',    product: 'Full Service' },
  { company: 'Concord Visa',         am: 'Marghi',    product: 'Full Service' },
  { company: 'Crescendo',            am: 'Marghi',    product: 'Full Service' },
  { company: 'Futurify',             am: 'Marghi',    product: 'Full Service' },
  { company: 'Metaview',             am: 'Marghi',    product: 'Full Service' },
  { company: 'Percents',             am: 'Marghi',    product: 'Full Service' },
  // Maxwell
  { company: 'Axya',                 am: 'Maxwell',   product: 'Full Service' },
  { company: 'Flora',                am: 'Maxwell',   product: 'Full Service' },
  { company: 'HustlePay',            am: 'Maxwell',   product: 'Full Service' },
  { company: 'Runpod',               am: 'Maxwell',   product: 'Full Service' },
  { company: 'Sourcera',             am: 'Maxwell',   product: 'Full Service' },
  { company: 'TerraFort',            am: 'Maxwell',   product: 'Full Service' },
  // Emily
  { company: 'Arga Labs',            am: 'Emily',     product: 'Full Service' },
  { company: 'Goody',                am: 'Emily',     product: 'Full Service' },
  { company: 'Knopman Marks',        am: 'Emily',     product: 'Full Service' },
  { company: 'Magnific (Freepik)',   am: 'Emily',     product: 'Full Service' },
  { company: 'Minimal',              am: 'Emily',     product: 'Full Service' },
  { company: 'Preface',              am: 'Emily',     product: 'Full Service' },
  // Daniel
  { company: 'Arceus',               am: 'Daniel',    product: 'Full Service' },
  { company: 'Daylit',               am: 'Daniel',    product: 'Full Service' },
  { company: 'Fergana Labs',         am: 'Daniel',    product: 'Full Service' },
  { company: 'Fermat Commerce',      am: 'Daniel',    product: 'Full Service' },
  { company: 'Hyperspell',           am: 'Daniel',    product: 'Full Service' },
  { company: 'Sybill',               am: 'Daniel',    product: 'Full Service' },
  { company: 'Vendelux',             am: 'Daniel',    product: 'Full Service' },
  { company: 'Watt',                 am: 'Daniel',    product: 'Full Service' },
  // Karishma
  { company: 'Hume AI',              am: 'Karishma',  product: 'Full Service' },
];
