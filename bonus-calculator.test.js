/* Unit tests for the AM bonus calculation engine.
   Run:  node bonus-calculator.test.js
   No dependencies — a tiny assert harness so it runs anywhere node does. */
const BC = require('./bonus-calculator.js');

let passed = 0, failed = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + name); }
}
function eq(name, actual, expected, eps) {
  const cond = (typeof expected === 'number' && typeof actual === 'number')
    ? approx(actual, expected, eps == null ? 1e-6 : eps)
    : actual === expected;
  if (!cond) console.error(`  ✗ FAIL: ${name}\n      expected ${expected}, got ${actual}`);
  cond ? passed++ : failed++;
}

// ── Book tier selection (hard step) ─────────────────────────────
eq('68k -> 50k tier',  BC.selectBookTier(68000).tier.mrr, 50000);
eq('90k -> 75k tier',  BC.selectBookTier(90000).tier.mrr, 75000);
eq('220k -> 150k tier', BC.selectBookTier(220000).tier.mrr, 150000);
eq('530k -> 500k tier', BC.selectBookTier(530000).tier.mrr, 500000);
eq('exact 50k -> 50k tier', BC.selectBookTier(50000).tier.mrr, 50000);
eq('49999 -> below-minimum', BC.selectBookTier(49999).status, 'below-minimum');
eq('50000 -> ok status', BC.selectBookTier(50000).status, 'ok');
eq('74999 -> 50k tier', BC.selectBookTier(74999).tier.mrr, 50000);
eq('75000 -> 75k tier', BC.selectBookTier(75000).tier.mrr, 75000);
eq('149999 -> 75k tier', BC.selectBookTier(149999).tier.mrr, 75000);
eq('150000 -> 150k tier', BC.selectBookTier(150000).tier.mrr, 150000);
eq('above 1M -> 1M tier', BC.selectBookTier(2500000).tier.mrr, 1000000);
eq('above 1M -> above-maximum status', BC.selectBookTier(2500000).status, 'above-maximum');

// ── NRR tier selection (lower achieved milestone) ───────────────
eq('109.99% -> below (0x)', BC.selectNRRTier(1.0999).tier.multiplier, 0);
eq('110% -> 1.0x',           BC.selectNRRTier(1.10).tier.multiplier, 1.0);
eq('119.99% -> 1.0x',        BC.selectNRRTier(1.1999).tier.multiplier, 1.0);
eq('120% -> 1.4x',           BC.selectNRRTier(1.20).tier.multiplier, 1.4);
eq('129.99% -> 1.4x',        BC.selectNRRTier(1.2999).tier.multiplier, 1.4);
eq('130% -> 2.0x',           BC.selectNRRTier(1.30).tier.multiplier, 2.0);
eq('147% -> 130 tier (2.0x)',BC.selectNRRTier(1.47).tier.multiplier, 2.0);
eq('149.99% -> 2.0x',        BC.selectNRRTier(1.4999).tier.multiplier, 2.0);
eq('150% -> 3.0x',           BC.selectNRRTier(1.50).tier.multiplier, 3.0);
eq('174.99% -> 3.0x',        BC.selectNRRTier(1.7499).tier.multiplier, 3.0);
eq('175% -> 4.5x',           BC.selectNRRTier(1.75).tier.multiplier, 4.5);
eq('199.99% -> 4.5x',        BC.selectNRRTier(1.9999).tier.multiplier, 4.5);
eq('200% -> 6.0x',           BC.selectNRRTier(2.00).tier.multiplier, 6.0);
eq('250% -> 6.0x (capped)',  BC.selectNRRTier(2.50).tier.multiplier, 6.0);

// ── Quarterly NRR ───────────────────────────────────────────────
eq('50k->55k = 110%', BC.calculateQuarterlyNRR(50000, 55000), 1.10);
eq('50k->60k = 120%', BC.calculateQuarterlyNRR(50000, 60000), 1.20);
eq('50k->75k = 150%', BC.calculateQuarterlyNRR(50000, 75000), 1.50);
eq('50k->100k = 200%', BC.calculateQuarterlyNRR(50000, 100000), 2.00);
ok('beginning 0 -> null NRR', BC.calculateQuarterlyNRR(0, 50000) === null);

// ── Smoothing ───────────────────────────────────────────────────
eq('smooth 150 & 120 = 135', BC.calculateSmoothedNRR(1.50, 1.20, true), 1.35);
eq('smooth off -> current', BC.calculateSmoothedNRR(1.50, 1.20, false), 1.50);
eq('no previous -> current', BC.calculateSmoothedNRR(1.50, null, true), 1.50);
eq('135% smoothed -> 130 tier', BC.selectNRRTier(BC.calculateSmoothedNRR(1.50, 1.20, true)).tier.multiplier, 2.0);

// ── Averaging months ────────────────────────────────────────────
eq('avg of 3 months', BC.calculateAverageManagedMRR(280000, 300000, 320000), 300000);

// ── Net expansion / ending ──────────────────────────────────────
eq('net expansion', BC.calculateNetExpansionMRR(120000, 20000, 10000), 90000);
eq('ending existing', BC.calculateEndingExistingCustomerMRR(300000, 90000), 390000);
eq('negative net expansion allowed', BC.calculateNetExpansionMRR(0, 10000, 20000), -30000);

// ── Full bonus matrix (baseline × multiplier) ───────────────────
const MATRIX = {
  50000:   { 1.0: 5000,   1.4: 7000,    2.0: 10000,  3.0: 15000,  4.5: 22500,  6.0: 30000 },
  75000:   { 1.0: 8000,   1.4: 11200,   2.0: 16000,  3.0: 24000,  4.5: 36000,  6.0: 48000 },
  150000:  { 1.0: 15000,  1.4: 21000,   2.0: 30000,  3.0: 45000,  4.5: 67500,  6.0: 90000 },
  300000:  { 1.0: 35000,  1.4: 49000,   2.0: 70000,  3.0: 105000, 4.5: 157500, 6.0: 210000 },
  500000:  { 1.0: 65000,  1.4: 91000,   2.0: 130000, 3.0: 195000, 4.5: 292500, 6.0: 390000 },
  750000:  { 1.0: 100000, 1.4: 140000,  2.0: 200000, 3.0: 300000, 4.5: 450000, 6.0: 600000 },
  1000000: { 1.0: 150000, 1.4: 210000,  2.0: 300000, 3.0: 450000, 4.5: 675000, 6.0: 900000 }
};
BC.DEFAULT_CONFIG.bookTiers.forEach(t => {
  Object.keys(MATRIX[t.mrr]).forEach(mult => {
    const m = parseFloat(mult);
    eq(`matrix ${t.mrr} @ ${m}x`, BC.calculateQuarterlyBonus(t.baselineBonus, m), MATRIX[t.mrr][mult]);
  });
});

// ── Expansion required for NRR (per book) ───────────────────────
eq('50k @110% needs 5k',  BC.calculateExpansionRequiredForNRR(50000, 1.10), 5000);
eq('50k @200% needs 50k', BC.calculateExpansionRequiredForNRR(50000, 2.00), 50000);
eq('300k @150% needs 150k', BC.calculateExpansionRequiredForNRR(300000, 1.50), 150000);
eq('75k @175% needs 56.25k', BC.calculateExpansionRequiredForNRR(75000, 1.75), 56250);

// ── Interpolation vs hard-tier ──────────────────────────────────
// Halfway between 50k ($5k) and 75k ($8k) at 62.5k => $6,500
eq('interp 62.5k baseline', BC.interpolateBaselineBonus(62500), 6500);
eq('hard-tier 62.5k baseline', BC.resolveBaselineBonus(62500, false), 5000);
eq('interp exact tier = baseline', BC.interpolateBaselineBonus(75000), 8000);
eq('interp above max clamps', BC.interpolateBaselineBonus(2000000), 150000);
eq('interp below min (proration off) = 0', BC.interpolateBaselineBonus(25000), 0);

// ── Proration below minimum (admin opt-in) ──────────────────────
const proCfg = Object.assign({}, BC.DEFAULT_CONFIG, { allowProrateBelowMinimum: true });
eq('prorate 25k -> 2500', BC.resolveBaselineBonus(25000, false, proCfg), 2500);

// ── currentNRR required for smoothed target ─────────────────────
eq('req current for 130 smoothed w/prev120', BC.calculateCurrentNRRRequiredForSmoothedTarget(1.30, 1.20, true), 1.40);
eq('req current = target when smoothing off', BC.calculateCurrentNRRRequiredForSmoothedTarget(1.30, 1.20, false), 1.30);

// ── FULL WORKED EXAMPLE from the spec ───────────────────────────
const r = BC.compute({
  mode: 'detailed',
  m1: 300000, m2: 300000, m3: 300000,
  beginningMRR: 300000,
  expansion: 120000, contraction: 20000, churned: 10000,
  newCustomerMRR: 50000,
  previousNRR: 1.20,
  smoothingOn: true,
  interpolate: false
});
eq('example: valid', r.valid, true);
eq('example: avg managed 300k', r.avgManagedMRR, 300000);
eq('example: net expansion 90k', r.netExpansionMRR, 90000);
eq('example: ending existing 390k', r.endingExistingMRR, 390000);
eq('example: current NRR 130%', r.currentNRR, 1.30);
eq('example: smoothed NRR 125%', r.smoothedNRR, 1.25);
eq('example: applied tier 120%', r.appliedNRRTier.label, '120%');
eq('example: multiplier 1.4x', r.multiplier, 1.4);
eq('example: baseline 35k', r.baselineBonus, 35000);
eq('example: quarterly bonus 49k', r.quarterlyBonus, 49000);
eq('example: annualized 196k', r.annualizedBonus, 196000);
eq('example: ending total managed 440k', r.endingTotalManagedMRR, 440000);
eq('example: next tier 130%', r.next.tierLabel, '130%');
eq('example: required current NRR 140%', r.next.requiredCurrentNRR, 1.40);
eq('example: required net expansion 120k', r.next.requiredNetExpansion, 120000);
eq('example: additional expansion needed 30k', r.next.additionalExpansionNeeded, 30000);
eq('example: next bonus 70k', r.next.nextBonus, 70000);
eq('example: additional bonus 21k', r.next.additionalBonus, 21000);

// ── Edge cases ──────────────────────────────────────────────────
// 1. Beginning zero -> invalid, no bonus
const eZero = BC.compute({ mode: 'simple', avgManagedMRR: 300000, beginningMRR: 0, endingMRR: 100000, smoothingOn: false });
ok('edge: beginning 0 invalid', eZero.valid === false && eZero.errors.length > 0);
eq('edge: beginning 0 bonus 0', eZero.quarterlyBonus, 0);

// 2. Missing previous NRR -> current alone
const eNoPrev = BC.compute({ mode: 'simple', avgManagedMRR: 300000, beginningMRR: 300000, endingMRR: 390000, previousNRR: null, smoothingOn: true });
eq('edge: no prev uses current 130%', eNoPrev.smoothedNRR, 1.30);
eq('edge: no prev -> 2.0x tier', eNoPrev.multiplier, 2.0);
eq('edge: no prev smoothingApplied false', eNoPrev.smoothingApplied, false);

// 3. Negative net expansion -> NRR < 100%, bonus 0
const eNeg = BC.compute({ mode: 'detailed', avgManagedMRR: 300000, beginningMRR: 300000, expansion: 0, contraction: 20000, churned: 40000, smoothingOn: false });
ok('edge: negative NRR < 1', eNeg.currentNRR < 1);
eq('edge: negative net -> 0 bonus', eNeg.quarterlyBonus, 0);

// 4. Between milestones -> lower (147% -> 130 tier)
const eBetween = BC.compute({ mode: 'simple', avgManagedMRR: 300000, beginningMRR: 300000, endingMRR: 441000, smoothingOn: false });
eq('edge: 147% -> 130 tier', eBetween.appliedNRRTier.label, '130%');

// 5. NRR > 200% -> 6.0x
const eHigh = BC.compute({ mode: 'simple', avgManagedMRR: 300000, beginningMRR: 300000, endingMRR: 900000, smoothingOn: false });
eq('edge: 300% -> 6.0x', eHigh.multiplier, 6.0);

// 6. Managed MRR below 50k -> below-minimum, 0 bonus
const eLowBook = BC.compute({ mode: 'simple', avgManagedMRR: 40000, beginningMRR: 40000, endingMRR: 60000, smoothingOn: false });
eq('edge: below min book status', eLowBook.bookTierStatus, 'below-minimum');
eq('edge: below min book bonus 0', eLowBook.quarterlyBonus, 0);

// 7. Managed MRR above 1M -> 1M tier w/ note
const eHighBook = BC.compute({ mode: 'simple', avgManagedMRR: 1500000, beginningMRR: 1500000, endingMRR: 1650000, smoothingOn: false });
eq('edge: above max uses 1M tier baseline', eHighBook.baselineBonus, 150000);
eq('edge: above max status', eHighBook.bookTierStatus, 'above-maximum');

// New-logo MRR excluded from NRR but included in total managed
const eNewLogo = BC.compute({ mode: 'detailed', avgManagedMRR: 300000, beginningMRR: 300000, expansion: 30000, contraction: 0, churned: 0, newCustomerMRR: 200000, smoothingOn: false });
eq('new-logo: current NRR 110% (excludes new logo)', eNewLogo.currentNRR, 1.10);
eq('new-logo: ending total includes new logo', eNewLogo.endingTotalManagedMRR, 530000);

// ── Snapshot-aware quarterly aggregation ────────────────────────
// Emily: Acme existing (start-of-Q baseline 200k+10k exp; now 200k+40k exp),
// Beacon existing (baseline 80k+10k; now 80k+22k, churn 5k), NewCo new (100k).
const AGG_ACCTS = [
  { id:'acme',  mrr:200000, expansion_mrr:40000, churned_mrr:0,    isNew:false },
  { id:'beacon',mrr:80000,  expansion_mrr:22000, churned_mrr:5000, isNew:false },
  { id:'newco', mrr:100000, expansion_mrr:0,     churned_mrr:0,    isNew:true  }
];
const AGG_BASELINE = {   // start of current quarter
  acme:  { mrr:200000, expansion_mrr:10000, churned_mrr:0 },
  beacon:{ mrr:80000,  expansion_mrr:10000, churned_mrr:0 }
};
const AGG_PRIOR = {      // start of previous quarter
  acme:  { mrr:200000, expansion_mrr:0, churned_mrr:0 },
  beacon:{ mrr:80000,  expansion_mrr:0, churned_mrr:0 }
};
const agg = BC.computeQuarterAggregate({ accounts:AGG_ACCTS, baseline:AGG_BASELINE, priorBaseline:AGG_PRIOR });
// begin = baseline totals: (200k+10k) + (80k+10k) = 300k
eq('agg begin = 300k (baseline totals)', agg.begin, 300000);
// this-quarter expansion = (40k-10k) + (22k-10k) = 42k
eq('agg in-quarter expansion = 42k', agg.exp, 42000);
// this-quarter churn = (0-0) + (5k-0) = 5k
eq('agg in-quarter churn = 5k', agg.churn, 5000);
// ending = current totals: (200k+40k) + (80k+22k-5k) = 337k
eq('agg ending = 337k', agg.ending, 337000);
eq('agg newMRR = 100k', agg.newMRR, 100000);
eq('agg managed book = 437k', agg.avgManaged, 437000);
eq('agg basis = snapshot', agg.basis, 'snapshot');
// previous-quarter NRR = end-of-prev (300k) / start-of-prev (280k) = ~107.1%
eq('agg previous NRR = 300k/280k', agg.previousNRR, 300000/280000);

// Fallback when no snapshot: base mrr as beginning, cumulative expansion as quarter's
const aggFb = BC.computeQuarterAggregate({ accounts:AGG_ACCTS, baseline:null, priorBaseline:null });
eq('fallback begin = base mrr 280k', aggFb.begin, 280000);
eq('fallback expansion = cumulative 62k', aggFb.exp, 62000);
eq('fallback basis = fallback', aggFb.basis, 'fallback');
eq('fallback previous NRR = null', aggFb.previousNRR, null);
eq('fallback still excludes new logo from cohort', aggFb.ending, 337000);

// Partial: one account has a baseline, one doesn't
const aggPart = BC.computeQuarterAggregate({ accounts:AGG_ACCTS, baseline:{ acme:AGG_BASELINE.acme }, priorBaseline:null });
eq('partial basis flagged', aggPart.basis, 'partial');
eq('partial begin = acme baseline 210k + beacon base 80k = 290k', aggPart.begin, 290000);

// Feeding the aggregate into compute() reproduces the $49k example
const aggR = BC.compute({ mode:'detailed', m1:agg.avgManaged, m2:agg.avgManaged, m3:agg.avgManaged,
  beginningMRR:agg.begin, expansion:agg.exp, contraction:0, churned:agg.churn,
  newCustomerMRR:agg.newMRR, previousNRR:null, smoothingOn:false });
eq('agg->compute current NRR = 337/300', aggR.currentNRR, 337000/300000);
eq('agg->compute book tier 300k', aggR.bookTier.mrr, 300000);

// ── Fairness ceiling: bonus ≤ 6% of annualized expansion ────────
// $1M book doubling (200%): net expansion $1M MRR = $12M ARR; 6% = $720k.
eq('maxBonusForExpansion 1M MRR -> $720k', BC.maxBonusForExpansion(1000000), 720000);
eq('capBonus: $900k capped to $720k', BC.capBonusToExpansion(900000, 1000000), 720000);
eq('capBonus: under ceiling passes through', BC.capBonusToExpansion(210000, 300000), 210000); // 6% of $3.6M=$216k
ok('ceiling disabled -> Infinity', BC.maxBonusForExpansion(1000000, Object.assign({}, BC.DEFAULT_CONFIG, {maxBonusPctOfExpansion:0})) === Infinity);
eq('ceiling non-negative expansion', BC.maxBonusForExpansion(-50000), 0);

// compute(): $1M @200% (via band floor) with matching expansion is held to $720k
const capHigh = BC.compute({ mode:'simple', avgManagedMRR:1000000, beginningMRR:1000000, endingMRR:2000000, smoothingOn:false });
eq('compute: 1M@200% uncapped would be $900k', capHigh.uncappedBonus, 900000);
eq('compute: 1M@200% capped to $720k', capHigh.quarterlyBonus, 720000);
eq('compute: capped flag set', capHigh.capped, true);
eq('compute: annualized reflects cap ($2.88M)', capHigh.annualizedBonus, 2880000);

// $300k @200% ($210k) sits just under 6% of $3.6M ($216k) -> not capped
const capMid = BC.compute({ mode:'simple', avgManagedMRR:300000, beginningMRR:300000, endingMRR:600000, smoothingOn:false });
eq('compute: 300k@200% not capped ($210k)', capMid.quarterlyBonus, 210000);
eq('compute: 300k@200% capped flag false', capMid.capped, false);

// $1M @110% baseline ($150k) exceeds 6% of $1.2M ($72k) -> capped
const capBaseline = BC.compute({ mode:'simple', avgManagedMRR:1000000, beginningMRR:1000000, endingMRR:1100000, smoothingOn:false });
eq('compute: 1M@110% baseline capped to $72k', capBaseline.quarterlyBonus, 72000);

// ── Churn disqualifier: 2+ logos in one month voids the bonus ───
const dqBase = { mode:'simple', avgManagedMRR:300000, beginningMRR:300000, endingMRR:600000, smoothingOn:false };
eq('0 churns in a month -> normal bonus', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:0})).quarterlyBonus, 210000);
eq('1 churn in a month -> still pays', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:1})).quarterlyBonus, 210000);
eq('2 churns in a month -> disqualified $0', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:2})).quarterlyBonus, 0);
eq('2 churns -> disqualified flag', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:2})).disqualified, true);
eq('3 churns -> disqualified $0', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:3})).quarterlyBonus, 0);
eq('disqualifier overrides even a huge quarter', BC.compute({ mode:'simple', avgManagedMRR:1000000, beginningMRR:1000000, endingMRR:2000000, maxChurnsInMonth:2, smoothingOn:false }).quarterlyBonus, 0);
eq('disqualifier tunable via config', BC.compute(Object.assign({}, dqBase, {maxChurnsInMonth:2}), Object.assign({}, BC.DEFAULT_CONFIG, {churnLogoDisqualifierPerMonth:3})).quarterlyBonus, 210000);

// ── Report ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed  (${passed + failed} total)`);
process.exit(failed ? 1 : 0);
