// Customer Success account roster — the scope for the response-time widgets.
//
// Source of truth: HubSpot companies where lifecycle stage = "Customer"
// (Virio's own company record excluded). Refresh this list from HubSpot when
// the customer roster changes — the compute job matches these to Slack channels.
//
//   company : HubSpot company name (also used to match the `virio-<company>` Slack channel)
//   am      : HubSpot company field "Account Manager" (csm) — the dropdown LABEL
//             (note: HubSpot's API returns internal names, so "CSM 2"->David, "Max"->Maxwell
//              were translated to labels here). "Unassigned" = deliberately on hold.
//   product : "EGC" when HubSpot `product` === "EGC"; otherwise "Full Service"
//             (blank or any other value => Full Service, per CS definition).
module.exports = [
  // Melissa
  { company: 'Netlify',        am: 'Melissa',    product: 'Full Service' },
  { company: 'Runpod',         am: 'Melissa',    product: 'Full Service' },
  { company: 'Trimble',        am: 'Melissa',    product: 'Full Service' },
  { company: 'Preface',        am: 'Melissa',    product: 'Full Service' },
  { company: 'Minimal',        am: 'Melissa',    product: 'Full Service' },
  // Marghi
  { company: 'Arceus',         am: 'Marghi',     product: 'Full Service' },
  { company: 'Vyrill',         am: 'Marghi',     product: 'Full Service' },
  { company: 'Futurify',       am: 'Marghi',     product: 'Full Service' },
  { company: 'Caspian',        am: 'Marghi',     product: 'Full Service' },
  { company: 'Crescendo',      am: 'Marghi',     product: 'Full Service' },
  { company: 'Percents',       am: 'Marghi',     product: 'Full Service' },
  { company: 'Goody',          am: 'Marghi',     product: 'Full Service' },
  // Jacob
  { company: 'Makora',         am: 'Jacob',      product: 'Full Service' },
  { company: 'Fergana Labs',   am: 'Jacob',      product: 'Full Service' },
  { company: 'Zaimler',        am: 'Jacob',      product: 'Full Service' },
  { company: 'Watt Data',      am: 'Jacob',      product: 'Full Service' },
  { company: 'AICRO',          am: 'Jacob',      product: 'Full Service' },
  { company: 'Tandem',         am: 'Jacob',      product: 'Full Service' },
  { company: 'InnovoCommerce', am: 'Jacob',      product: 'Full Service' },
  { company: 'Vendelux',       am: 'Jacob',      product: 'Full Service' },
  { company: 'Sybill',         am: 'Jacob',      product: 'Full Service' },
  // Maxwell
  { company: 'HustlePay',      am: 'Maxwell',    product: 'Full Service' },
  { company: 'Sourcera',       am: 'Maxwell',    product: 'Full Service' },
  { company: 'Metaview',       am: 'Maxwell',    product: 'Full Service' },
  { company: 'Knopman Marks',  am: 'Maxwell',    product: 'Full Service' },
  { company: 'Flora',          am: 'Maxwell',    product: 'Full Service' },
  { company: 'Axya',           am: 'Maxwell',    product: 'Full Service' },
  // David  (HubSpot internal value "CSM 2")
  { company: 'QWNTL Labs',     am: 'David',      product: 'Full Service' },
  { company: 'Daylit',         am: 'David',      product: 'Full Service' },
  { company: 'Fastshot',       am: 'David',      product: 'Full Service' },
  { company: 'TerraFort',      am: 'David',      product: 'Full Service' },
  { company: 'Hume AI',        am: 'David',      product: 'Full Service' },
  { company: 'Concord Visa',   am: 'David',      product: 'Full Service' },
  { company: 'Hyperspell',     am: 'David',      product: 'Full Service' },
  { company: 'Freepik',        am: 'David',      product: 'Full Service' },
  // EGC accounts — AM unassigned (Emmett is no longer an AM)
  { company: 'VitalBenefits',  am: 'Unassigned', product: 'EGC' },
  { company: 'Othello',        am: 'Unassigned', product: 'EGC' },
  // Unassigned (on hold)
  { company: 'Hobbes',         am: 'Unassigned', product: 'Full Service' },
  { company: 'Koah',           am: 'Unassigned', product: 'Full Service' },
];
