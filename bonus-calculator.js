/* ────────────────────────────────────────────────────────────────
   Account Manager Quarterly Bonus — calculation engine
   ----------------------------------------------------------------
   Single source of truth for all bonus math. Pure, config-driven,
   and independently testable. Used by the dashboard (window.BonusCalc)
   and by the node test suite (module.exports).

   All plan values live in DEFAULT_CONFIG so thresholds, book tiers,
   bonuses and multipliers can be edited without touching the logic.
   ──────────────────────────────────────────────────────────────── */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node
  root.BonusCalc = api;                                                      // browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Plan configuration ────────────────────────────────────────
  // Edit here to change the plan. Nothing below reads hard-coded plan
  // values — every function takes a config (defaulting to this one).
  const DEFAULT_CONFIG = {
    bookTiers: [
      { mrr: 50000,   baselineBonus: 5000 },
      { mrr: 75000,   baselineBonus: 8000 },
      { mrr: 150000,  baselineBonus: 15000 },
      { mrr: 300000,  baselineBonus: 35000 },
      { mrr: 500000,  baselineBonus: 65000 },
      { mrr: 750000,  baselineBonus: 100000 },
      { mrr: 1000000, baselineBonus: 150000 }
    ],
    nrrTiers: [
      { minimumNRR: 0,    multiplier: 0,   label: 'Below 110%' },
      { minimumNRR: 1.10, multiplier: 1.0, label: '110%' },
      { minimumNRR: 1.20, multiplier: 1.4, label: '120%' },
      { minimumNRR: 1.30, multiplier: 2.0, label: '130%' },
      { minimumNRR: 1.50, multiplier: 3.0, label: '150%' },
      { minimumNRR: 1.75, multiplier: 4.5, label: '175%' },
      { minimumNRR: 2.00, multiplier: 6.0, label: '200%+' }
    ],
    smoothingQuarters: 2,
    minimumEligibleNRR: 1.10,
    minimumManagedMRR: 50000,
    maximumPublishedManagedMRR: 1000000,
    // When true, portfolios below the minimum published tier earn a
    // prorated baseline (linear from $0 at $0 MRR up to the first tier).
    allowProrateBelowMinimum: false,
    // Hard fairness ceiling: a quarter's bonus can never exceed this fraction
    // of the expansion the AM generated, so an AM's rate on expansion never
    // exceeds what an AE earns on new business. The expansion is scaled by
    // expansionCapMonths first (12 = annualized/ARR value of the net MRR added;
    // 1 = the raw quarterly MRR figure). Set maxBonusPctOfExpansion to 0 to
    // disable the ceiling.
    maxBonusPctOfExpansion: 0.06,
    expansionCapMonths: 12,
    // Hard disqualifier: this many customer logos churning within a SINGLE month
    // voids the entire quarterly bonus, regardless of expansion. Set to 0 to
    // disable.
    churnLogoDisqualifierPerMonth: 2,
    // Split between individual and team performance. 0.5 = 50% of the bonus is
    // driven by the AM's own NRR, 50% by the team's NRR (both on the AM's own
    // band baseline).
    individualWeight: 0.5
  };

  // ── Small helpers ──────────────────────────────────────────────
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v, fallback = 0) => (isNum(v) ? v : fallback);

  // ── 1. Average managed MRR ─────────────────────────────────────
  // Average of the three monthly managed-MRR figures for the quarter.
  function calculateAverageManagedMRR(m1, m2, m3) {
    return (num(m1) + num(m2) + num(m3)) / 3;
  }

  // ── 2. Net expansion MRR ───────────────────────────────────────
  // Expansion minus contraction minus churn. Can be negative.
  function calculateNetExpansionMRR(expansion, contraction, churned) {
    return num(expansion) - num(contraction) - num(churned);
  }

  // ── 3. Ending existing-customer MRR ────────────────────────────
  // Beginning cohort plus net expansion. Excludes new-logo MRR.
  function calculateEndingExistingCustomerMRR(beginning, netExpansion) {
    return num(beginning) + num(netExpansion);
  }

  // ── 4. Quarterly NRR ───────────────────────────────────────────
  // Ending / beginning for the existing-customer cohort.
  // Returns null when beginning MRR is zero/invalid (cannot divide).
  function calculateQuarterlyNRR(beginning, ending) {
    if (!isNum(beginning) || beginning <= 0) return null;
    return num(ending) / beginning;
  }

  // ── 5. Smoothed NRR ────────────────────────────────────────────
  // Average of current and previous quarter NRR when smoothing is on
  // and a previous value exists; otherwise current NRR alone.
  function calculateSmoothedNRR(currentNRR, previousNRR, smoothingOn, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (currentNRR == null) return null;
    if (!smoothingOn || previousNRR == null || !isNum(previousNRR)) return currentNRR;
    const q = cfg.smoothingQuarters || 2;
    // 2-quarter plan: (current + previous) / 2. Generalised by quarter count.
    return (currentNRR + previousNRR * (q - 1)) / q;
  }

  // ── 6. Select book tier (hard step) ────────────────────────────
  // Highest published tier whose MRR is <= average managed MRR.
  // Returns { tier, index, status } where status is one of
  // 'ok' | 'below-minimum' | 'above-maximum'.
  function selectBookTier(avgMRR, config) {
    const cfg = config || DEFAULT_CONFIG;
    const tiers = cfg.bookTiers;
    if (!isNum(avgMRR) || avgMRR < cfg.minimumManagedMRR) {
      return { tier: null, index: -1, status: 'below-minimum' };
    }
    let idx = -1;
    for (let i = 0; i < tiers.length; i++) {
      if (avgMRR >= tiers[i].mrr) idx = i;
    }
    const status = avgMRR > cfg.maximumPublishedManagedMRR ? 'above-maximum' : 'ok';
    return { tier: tiers[idx], index: idx, status };
  }

  // ── 7. Interpolate baseline bonus between tiers ────────────────
  // Linear interpolation of baseline bonus between the two nearest
  // book tiers. Clamps to the top tier above the maximum. Honours
  // optional proration below the minimum tier.
  function interpolateBaselineBonus(avgMRR, config) {
    const cfg = config || DEFAULT_CONFIG;
    const tiers = cfg.bookTiers;
    if (!isNum(avgMRR) || avgMRR <= 0) return 0;
    const first = tiers[0];
    const last = tiers[tiers.length - 1];

    if (avgMRR < first.mrr) {
      return cfg.allowProrateBelowMinimum
        ? first.baselineBonus * (avgMRR / first.mrr)
        : 0;
    }
    if (avgMRR >= last.mrr) return last.baselineBonus;

    for (let i = 0; i < tiers.length - 1; i++) {
      const lo = tiers[i], hi = tiers[i + 1];
      if (avgMRR >= lo.mrr && avgMRR <= hi.mrr) {
        const frac = (avgMRR - lo.mrr) / (hi.mrr - lo.mrr);
        return lo.baselineBonus + frac * (hi.baselineBonus - lo.baselineBonus);
      }
    }
    return last.baselineBonus;
  }

  // ── Baseline bonus (respects interpolation + proration setting) ─
  // Resolves the baseline quarterly bonus for a given average managed
  // MRR, applying either hard-step tiers or interpolation.
  function resolveBaselineBonus(avgMRR, interpolate, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (interpolate) return interpolateBaselineBonus(avgMRR, cfg);
    const sel = selectBookTier(avgMRR, cfg);
    if (sel.status === 'below-minimum') {
      return cfg.allowProrateBelowMinimum
        ? cfg.bookTiers[0].baselineBonus * (num(avgMRR) / cfg.bookTiers[0].mrr)
        : 0;
    }
    return sel.tier.baselineBonus;
  }

  // ── 8. Select NRR tier ─────────────────────────────────────────
  // Highest milestone whose minimum NRR is <= the (smoothed) NRR.
  // Between milestones resolves down to the lower achieved milestone.
  function selectNRRTier(nrr, config) {
    const cfg = config || DEFAULT_CONFIG;
    const tiers = cfg.nrrTiers;
    if (nrr == null || !isNum(nrr)) return { tier: tiers[0], index: 0 };
    let idx = 0;
    for (let i = 0; i < tiers.length; i++) {
      if (nrr >= tiers[i].minimumNRR) idx = i;
    }
    return { tier: tiers[idx], index: idx };
  }

  // ── 9. Quarterly bonus ─────────────────────────────────────────
  function calculateQuarterlyBonus(baselineBonus, multiplier) {
    return num(baselineBonus) * num(multiplier);
  }

  // ── 10. Annualized bonus (run-rate) ────────────────────────────
  function calculateAnnualizedBonus(quarterlyBonus) {
    return num(quarterlyBonus) * 4;
  }

  // ── Fairness ceiling: max bonus as a % of the expansion generated ──
  // Returns the largest bonus payable for a given net expansion MRR, so the
  // bonus never exceeds maxBonusPctOfExpansion of that expansion's value
  // (scaled by expansionCapMonths). Infinity when the ceiling is disabled or
  // expansion is non-positive-capped.
  function maxBonusForExpansion(netExpansionMRR, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (!(cfg.maxBonusPctOfExpansion > 0)) return Infinity;
    const months = cfg.expansionCapMonths || 1;
    return cfg.maxBonusPctOfExpansion * Math.max(0, num(netExpansionMRR)) * months;
  }
  // Apply the ceiling to a bonus for a given expansion.
  function capBonusToExpansion(bonus, netExpansionMRR, config) {
    return Math.min(num(bonus), maxBonusForExpansion(netExpansionMRR, config));
  }

  // ── 50/50 split: combine individual + team into the final bonus ──
  // individualBonus = the AM's own capped/disqualified bonus. teamEffMult = the
  // team's (capped) NRR multiplier. Both halves share the AM's band baseline, so
  // the team half is 50% of the AM's own scale driven by team performance.
  function combineBonus(individualBonus, baseline, teamEffMult, config) {
    const cfg = config || DEFAULT_CONFIG;
    const w = (cfg.individualWeight == null) ? 0.5 : cfg.individualWeight;
    const individualHalf = w * num(individualBonus);
    const teamHalf = (1 - w) * num(baseline) * num(teamEffMult);
    return { individualHalf, teamHalf, total: individualHalf + teamHalf, weight: w };
  }

  // ── 11. Expansion required to reach an NRR level ───────────────
  // Net expansion MRR needed on a given cohort/book to hit target NRR.
  function calculateExpansionRequiredForNRR(bookMRR, nrr) {
    return num(bookMRR) * (num(nrr) - 1);
  }

  // ── 12. Current NRR required to hit a smoothed target ──────────
  // Inverts the smoothing formula. With smoothing off (or no prior),
  // the required current NRR equals the target.
  function calculateCurrentNRRRequiredForSmoothedTarget(targetSmoothed, previousNRR, smoothingOn, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (!smoothingOn || previousNRR == null || !isNum(previousNRR)) return targetSmoothed;
    const q = cfg.smoothingQuarters || 2;
    // smoothed = (current + previous*(q-1)) / q  ⇒  current = target*q - previous*(q-1)
    return targetSmoothed * q - previousNRR * (q - 1);
  }

  // ── 13. Additional net expansion needed for the next tier ──────
  // Given the current applied NRR tier, works out how much more
  // current-quarter net expansion is required to reach the next
  // milestone (accounting for smoothing). Returns null at the top tier.
  function calculateAdditionalExpansionNeededForNextTier(opts) {
    const cfg = opts.config || DEFAULT_CONFIG;
    const { beginningMRR, currentNetExpansion, appliedTierIndex, previousNRR, smoothingOn } = opts;
    const tiers = cfg.nrrTiers;
    if (appliedTierIndex >= tiers.length - 1) return null; // already at top
    if (!isNum(beginningMRR) || beginningMRR <= 0) return null;

    const nextTier = tiers[appliedTierIndex + 1];
    const requiredCurrentNRR = calculateCurrentNRRRequiredForSmoothedTarget(
      nextTier.minimumNRR, previousNRR, smoothingOn, cfg
    );
    const requiredEnding = beginningMRR * requiredCurrentNRR;
    const requiredNetExpansion = requiredEnding - beginningMRR;
    const additionalNeeded = requiredNetExpansion - num(currentNetExpansion);
    return {
      nextTier,
      requiredCurrentNRR,
      requiredEnding,
      requiredNetExpansion,
      additionalNeeded
    };
  }

  // ── 14. Additional bonus unlocked at the next tier ─────────────
  function calculateAdditionalBonusAtNextTier(baselineBonus, currentMultiplier, nextMultiplier) {
    return num(baselineBonus) * num(nextMultiplier) - num(baselineBonus) * num(currentMultiplier);
  }

  // ── Snapshot-aware quarterly aggregation ───────────────────────
  // Turns an AM's cohort into the calculator's quarterly inputs. When a
  // start-of-quarter snapshot is available, expansion/churn are measured as the
  // delta since that baseline (true in-quarter movement) and beginning MRR is
  // the baseline total.
  //
  // `isNew` means a genuinely NEW LOGO this quarter (new business), NOT merely an
  // account that is new to this AM's book. That distinction matters: a customer
  // reassigned to a different AM must never read as new-customer growth or as
  // expansion for the receiving AM. So an existing account that is NOT in this
  // AM's baseline (a reassigned/handed-over book, or an AM with no snapshot at
  // all) is treated as NEUTRAL — it anchors the book at its current value with
  // zero attributed expansion or churn. In-quarter expansion is credited ONLY
  // against a real start-of-quarter baseline, so no one is credited for a book
  // they simply inherited.
  //
  // All inputs are pre-filtered to one AM:
  //   accounts:      [{ id, mrr, expansion_mrr, churned_mrr, isNew }]  isNew = new logo this Q
  //   baseline:      { [id]: {mrr, expansion_mrr, churned_mrr} }  start-of-current-Q, or null
  //   priorBaseline: { [id]: {mrr, expansion_mrr, churned_mrr} }  start-of-previous-Q, or null
  // NOTE ON SEMANTICS: HubSpot's `mrr` is an account's TOTAL monthly revenue and
  // already includes whatever is in `expansion_mrr` — the latter is a component
  // broken out of it so expansion can be credited on its own. Totals therefore
  // use mrr alone; adding expansion on top double-counts it. The expansion and
  // churn figures below stay as DELTAS against the baseline, which is still the
  // right measure of what moved inside the quarter.
  function accountTotal(a) { return num(a.mrr) - num(a.churned_mrr); }
  function computeQuarterAggregate(opts) {
    const accounts = opts.accounts || [];
    const baseline = opts.baseline || null;
    const priorBaseline = opts.priorBaseline || null;
    let begin = 0, exp = 0, churn = 0, ending = 0, newMRR = 0;
    let snapshotAccounts = 0, fallbackAccounts = 0;

    accounts.forEach(a => {
      const cur = accountTotal(a);
      if (a.isNew) { newMRR += cur; return; }              // genuinely new logo → new business, never expansion
      const b = baseline && baseline[a.id];
      if (b) {
        begin  += num(b.mrr) - num(b.churned_mrr);
        exp    += num(a.expansion_mrr) - num(b.expansion_mrr);
        churn  += num(a.churned_mrr)   - num(b.churned_mrr);
        ending += cur;
        snapshotAccounts++;
      } else {
        // Existing logo with no start-of-quarter baseline for THIS owner (e.g. a
        // reassigned book). Neutral: anchor the book at its current value and
        // attribute NO expansion/churn — crediting its lifetime expansion_mrr
        // here would reward a reassignment as growth the owner didn't generate.
        begin  += cur;
        ending += cur;
        fallbackAccounts++;
      }
    });

    // Previous-quarter NRR from the two snapshots: end-of-prev (= start-of-current
    // baseline) ÷ start-of-prev, over accounts present at the start of the prior
    // quarter. An account that churned out between snapshots contributes 0 to the
    // numerator, so churn pulls previous NRR down (consistent with the plan).
    let previousNRR = null;
    if (baseline && priorBaseline) {
      let pBegin = 0, pEnd = 0;
      Object.keys(priorBaseline).forEach(id => {
        const p = priorBaseline[id];
        pBegin += num(p.mrr) - num(p.churned_mrr);
        const e = baseline[id];
        if (e) pEnd += num(e.mrr) - num(e.churned_mrr);
      });
      if (pBegin > 0) previousNRR = pEnd / pBegin;
    }

    return {
      begin, exp, churn, ending, newMRR,
      avgManaged: ending + newMRR,
      previousNRR, snapshotAccounts, fallbackAccounts,
      basis: snapshotAccounts > 0 ? (fallbackAccounts > 0 ? 'partial' : 'snapshot') : 'fallback'
    };
  }

  // ── Orchestrator ───────────────────────────────────────────────
  // Runs the full calculation from a normalized input object and
  // returns every value the UI needs to display. Never throws — it
  // reports validity via `valid` + `errors`.
  //
  // input = {
  //   mode: 'simple' | 'detailed',
  //   avgManagedMRR,                 // simple
  //   m1, m2, m3,                    // detailed (override avg if provided)
  //   beginningMRR,
  //   endingMRR,                     // simple
  //   expansion, contraction, churned, // detailed
  //   newCustomerMRR,
  //   previousNRR,                   // may be null
  //   smoothingOn, interpolate
  // }
  function compute(input, config) {
    const cfg = config || DEFAULT_CONFIG;
    const errors = [];
    const detailed = input.mode === 'detailed';

    // Average managed MRR (from months in detailed mode when provided)
    let avgMRR;
    if (detailed && (isNum(input.m1) || isNum(input.m2) || isNum(input.m3))) {
      avgMRR = calculateAverageManagedMRR(input.m1, input.m2, input.m3);
    } else {
      avgMRR = num(input.avgManagedMRR);
    }

    // Cohort movement
    const beginning = num(input.beginningMRR);
    let netExpansion, ending;
    if (detailed) {
      netExpansion = calculateNetExpansionMRR(input.expansion, input.contraction, input.churned);
      ending = calculateEndingExistingCustomerMRR(beginning, netExpansion);
    } else {
      ending = num(input.endingMRR);
      netExpansion = ending - beginning;
    }

    // Validation — beginning cohort must be > 0 to compute NRR
    if (!isNum(beginning) || beginning <= 0) {
      errors.push('Beginning existing-customer MRR must be greater than zero to calculate NRR.');
    }

    const currentNRR = calculateQuarterlyNRR(beginning, ending);
    const smoothingApplied = !!input.smoothingOn && input.previousNRR != null && isNum(input.previousNRR);
    const smoothedNRR = calculateSmoothedNRR(currentNRR, input.previousNRR, input.smoothingOn, cfg);

    // Book tier + baseline
    const bookSel = selectBookTier(avgMRR, cfg);
    const baselineBonus = resolveBaselineBonus(avgMRR, input.interpolate, cfg);

    // NRR tier + multiplier
    const nrrSel = selectNRRTier(smoothedNRR, cfg);
    const multiplier = nrrSel.tier.multiplier;

    // Bonus
    let quarterlyBonus = calculateQuarterlyBonus(baselineBonus, multiplier);
    // Below the minimum book tier with proration off ⇒ $0
    if (bookSel.status === 'below-minimum' && !cfg.allowProrateBelowMinimum) quarterlyBonus = 0;
    if (errors.length) quarterlyBonus = 0;
    // Fairness ceiling: never more than X% of the expansion generated.
    const uncappedBonus = quarterlyBonus;
    const expansionCeiling = maxBonusForExpansion(netExpansion, cfg);
    quarterlyBonus = Math.min(quarterlyBonus, expansionCeiling);
    const capped = quarterlyBonus < uncappedBonus;
    // Hard disqualifier: N customer logos churning in a single month voids the
    // whole bonus, regardless of expansion.
    const maxChurnsInMonth = num(input.maxChurnsInMonth);
    const disqualified = cfg.churnLogoDisqualifierPerMonth > 0 &&
      maxChurnsInMonth >= cfg.churnLogoDisqualifierPerMonth;
    if (disqualified) quarterlyBonus = 0;
    const annualizedBonus = calculateAnnualizedBonus(quarterlyBonus);

    // Next-tier progress
    const nextInfo = errors.length ? null : calculateAdditionalExpansionNeededForNextTier({
      beginningMRR: beginning,
      currentNetExpansion: netExpansion,
      appliedTierIndex: nrrSel.index,
      previousNRR: input.previousNRR,
      smoothingOn: input.smoothingOn,
      config: cfg
    });
    // Next-tier bonus, also held under the expansion ceiling (the next tier
    // requires more expansion, which raises its ceiling accordingly).
    let additionalBonusNext = null, nextBonusCapped = null;
    if (nextInfo) {
      nextBonusCapped = Math.min(
        baselineBonus * nextInfo.nextTier.multiplier,
        maxBonusForExpansion(nextInfo.requiredNetExpansion, cfg)
      );
      additionalBonusNext = nextBonusCapped - quarterlyBonus;
    }

    const endingTotalManagedMRR = ending + num(input.newCustomerMRR);

    return {
      valid: errors.length === 0,
      errors,
      avgManagedMRR: avgMRR,
      bookTier: bookSel.tier,
      bookTierStatus: bookSel.status,
      interpolated: !!input.interpolate,
      baselineBonus,
      beginningMRR: beginning,
      endingExistingMRR: ending,
      netExpansionMRR: netExpansion,
      currentNRR,
      previousNRR: (input.previousNRR != null && isNum(input.previousNRR)) ? input.previousNRR : null,
      smoothingApplied,
      smoothedNRR,
      appliedNRRTier: nrrSel.tier,
      appliedNRRTierIndex: nrrSel.index,
      multiplier,
      quarterlyBonus,
      uncappedBonus,
      capped,
      expansionCeiling,
      disqualified,
      maxChurnsInMonth,
      annualizedBonus,
      newCustomerMRR: num(input.newCustomerMRR),
      endingTotalManagedMRR,
      next: nextInfo ? {
        tierLabel: nextInfo.nextTier.label,
        requiredCurrentNRR: nextInfo.requiredCurrentNRR,
        requiredNetExpansion: nextInfo.requiredNetExpansion,
        additionalExpansionNeeded: nextInfo.additionalNeeded,
        additionalBonus: additionalBonusNext,
        nextBonus: nextBonusCapped
      } : null
    };
  }

  return {
    DEFAULT_CONFIG,
    calculateAverageManagedMRR,
    calculateNetExpansionMRR,
    calculateEndingExistingCustomerMRR,
    calculateQuarterlyNRR,
    calculateSmoothedNRR,
    selectBookTier,
    interpolateBaselineBonus,
    resolveBaselineBonus,
    selectNRRTier,
    calculateQuarterlyBonus,
    calculateAnnualizedBonus,
    calculateExpansionRequiredForNRR,
    calculateCurrentNRRRequiredForSmoothedTarget,
    calculateAdditionalExpansionNeededForNextTier,
    calculateAdditionalBonusAtNextTier,
    maxBonusForExpansion,
    capBonusToExpansion,
    combineBonus,
    computeQuarterAggregate,
    compute
  };
});
