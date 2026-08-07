/* ────────────────────────────────────────────────────────────────
   AM Quarterly Bonus Calculator — public (candidate-facing) build.
   Manual entry only: no HubSpot data, no AM roster, no snapshots, no
   auth. All plan math comes from bonus-calculator.js (BonusCalc).
   ──────────────────────────────────────────────────────────────── */

// ── formatters / parsers ───────────────────────────────────────
function bFmt$(n){ if(n==null||!isFinite(n)) return '—'; const neg=n<0; return (neg?'-$':'$')+Math.round(Math.abs(n)).toLocaleString('en-US'); }
function bFmtK(n){ if(n==null||!isFinite(n)) return '—'; const a=Math.abs(n),s=n<0?'-':'';
  if(a>=1e6) return s+'$'+(a/1e6).toFixed(2).replace(/\.?0+$/,'')+'M';
  if(a>=1000) return s+'$'+(a/1000).toFixed(1).replace(/\.0$/,'')+'k';
  return s+'$'+Math.round(a); }
function bPct(x){ return (x==null||!isFinite(x))?'—':(x*100).toFixed(1)+'%'; }
function bParseMoney(s){ if(s==null) return 0; const n=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isFinite(n)?n:0; }
function bHasVal(s){ return s!=null && String(s).replace(/[^0-9.\-]/g,'')!==''; }
function bParsePct(s){ if(!bHasVal(s)) return null; const n=parseFloat(String(s).replace(/[^0-9.\-]/g,'')); return isFinite(n)?n/100:null; }
function bVal(id){ const el=document.getElementById(id); return el?el.value:''; }
function set(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const BONUS_BAND_LABELS = { '50000':'$50k–$75k','75000':'$75k–$150k','150000':'$150k–$300k','300000':'$300k–$500k','500000':'$500k–$750k','750000':'$750k–$1M','1000000':'$1M+' };
function bonusBandLabel(mrr){ return BONUS_BAND_LABELS[String(mrr)] || 'Below $50k'; }

const BONUS_FIELDS = ['bi-band','bi-teamnrr','bi-begin-s','bi-end-s','bi-begin-d','bi-exp','bi-con','bi-churn','bi-new','bi-churnmax'];
const BONUS_KEY = 'virio-bonus-public-inputs';
const BONUS_SCEN_KEY = 'virio-bonus-public-scenarios';
const bonusExample = { 'bi-band':'300000','bi-teamnrr':'120','bi-begin-s':'$300,000','bi-end-s':'$390,000' };
const bonusState = { mode:'simple' };

// ── tooltips (info icons) ──────────────────────────────────────
let tipEl;
function showInfoTip(e,title,html){ tipEl=tipEl||document.getElementById('tip'); document.getElementById('tip-title').textContent=title; document.getElementById('tip-body').innerHTML='<div class="tip-info">'+html+'</div>'; tipEl.classList.add('visible'); posTip(e); }
function showInfo(e,key){ const i=FC_INFO[key]; if(i) showInfoTip(e,i.title,i.html); }
function posTip(e){ tipEl=tipEl||document.getElementById('tip'); const pad=14,w=tipEl.offsetWidth,h=tipEl.offsetHeight;
  tipEl.style.left=(e.clientX+pad+w>window.innerWidth?e.clientX-w-pad:e.clientX+pad)+'px';
  tipEl.style.top=(e.clientY+pad+h>window.innerHeight?e.clientY-h-pad:e.clientY+pad)+'px'; }
function hideTip(){ tipEl=tipEl||document.getElementById('tip'); tipEl.classList.remove('visible'); }
const FC_INFO = {
  bonusBand:{ title:'Book band', html:
    "<div class='r'>Your <b>total managed book</b> — every account you manage — falls into a band ($50k–$75k … $1M+).</div>"
    +"<div class='r'>The band sets your <b>baseline bonus</b> (the amount earned at 110% NRR).</div>" },
  bonusTeamNrr:{ title:'Team half (50%)', html:
    "<div class='r'>Half of every AM's bonus rides on the <b>whole team's</b> combined Quarterly NRR — the same number for everyone.</div>"
    +"<div class='r'>Your team half = <b>50% × your band baseline × the team's NRR multiplier</b>. Your own churn never affects it.</div>" },
  bonusChurnDq:{ title:'Churn disqualifier', html:
    "<div class='r'>Enter the <b>most customer logos that churned in any single month</b> of the quarter.</div>"
    +"<div class='r'><b>2 or more in one month voids the individual half</b> of the bonus, regardless of expansion. The team half still applies.</div>" },
  bonusAnnual:{ title:'Annualized run-rate', html:
    "<div class='r'>Simply your quarterly bonus × 4 — an <b>illustrative annualized run-rate</b>, not a guaranteed annual bonus.</div>" },
  bonusTotalBook:{ title:'Ending total managed book', html:
    "<div class='r'>Ending <b>existing-customer</b> MRR plus any <b>new customers</b> added during the quarter.</div>"
    +"<div class='r'>New-customer MRR grows your book but is <b>excluded</b> from Quarterly NRR (which measures the existing cohort).</div>" }
};

// ── init ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function(){
  bonusRenderMatrix();
  bonusRenderExpNeedMatrix();
  document.querySelectorAll('.bonus-in').forEach(el=>{
    const ev = el.type==='checkbox' ? 'change' : 'input';
    el.addEventListener(ev, ()=>{ bonusPersist(); bonusRecompute(); });
  });
  bonusLoad();
  bonusRenderSlots();
  bonusRecompute();
});

// ── mode switch ────────────────────────────────────────────────
function bonusSetMode(mode){
  bonusState.mode = mode;
  document.querySelectorAll('#bonus-mode .prt-seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));
  document.getElementById('bonus-simple-fields').style.display   = mode==='simple' ? '' : 'none';
  document.getElementById('bonus-detailed-fields').style.display = mode==='detailed' ? '' : 'none';
  bonusPersist(); bonusRecompute();
}

// ── persistence (single sandbox, this browser only) ────────────
function bonusPersist(){
  const data={ mode: bonusState.mode };
  BONUS_FIELDS.forEach(id=> data[id]=bVal(id));
  try{ localStorage.setItem(BONUS_KEY, JSON.stringify(data)); }catch(e){}
}
function bonusApply(data){
  BONUS_FIELDS.forEach(id=>{ const el=document.getElementById(id); if(el) el.value = data[id]!=null?data[id]:''; });
  bonusSetMode(data.mode||'simple');
}
function bonusLoad(){
  let data=null;
  try{ const raw=localStorage.getItem(BONUS_KEY); if(raw) data=JSON.parse(raw); }catch(e){}
  bonusApply(data || Object.assign({mode:'simple'}, bonusExample));
}

// ── read inputs ────────────────────────────────────────────────
function bonusReadInputs(){
  const mode=bonusState.mode;
  const inp={ mode, smoothingOn:false, interpolate:false, previousNRR:null,
    avgManagedMRR: parseFloat(bVal('bi-band'))||0, newCustomerMRR:0,
    maxChurnsInMonth: parseInt(String(bVal('bi-churnmax')).replace(/[^0-9]/g,''),10)||0 };
  if(mode==='simple'){ inp.beginningMRR=bParseMoney(bVal('bi-begin-s')); inp.endingMRR=bParseMoney(bVal('bi-end-s')); }
  else { inp.beginningMRR=bParseMoney(bVal('bi-begin-d')); inp.expansion=bParseMoney(bVal('bi-exp')); inp.contraction=bParseMoney(bVal('bi-con')); inp.churned=bParseMoney(bVal('bi-churn')); inp.newCustomerMRR=bParseMoney(bVal('bi-new')); }
  return inp;
}

// ── recompute + render ─────────────────────────────────────────
let bonusLastResult=null, bonusLastCombo=null, bonusLastTeamNRR=null, bonusDisplayTotal=0;
function bonusRecompute(){
  const cfg = BonusCalc.DEFAULT_CONFIG;
  const r = BonusCalc.compute(bonusReadInputs(), cfg);
  bonusLastResult = r;

  const errEl = document.getElementById('bonus-err');
  if(r.errors.length){ errEl.textContent=r.errors[0]; errEl.classList.add('show'); }
  else if(r.disqualified){ errEl.textContent=`Bonus disqualified — ${r.maxChurnsInMonth} customers churned in a single month (2+ voids the individual half, regardless of expansion).`; errEl.classList.add('show'); }
  else errEl.classList.remove('show');

  const bandLabel=(r.bookTierStatus==='below-minimum'||!r.bookTier)?'Below $50k':bonusBandLabel(r.bookTier.mrr);

  // team half — manual team NRR, raw multiplier
  const teamNRRfield=bParsePct(bVal('bi-teamnrr'));
  let teamEffMult=0, teamNRRused=null;
  if(teamNRRfield!=null){ teamEffMult=BonusCalc.selectNRRTier(teamNRRfield).tier.multiplier; teamNRRused=teamNRRfield; }
  const combo=BonusCalc.combineBonus(r.quarterlyBonus, r.baselineBonus, teamEffMult, cfg);
  bonusLastCombo=combo; bonusLastTeamNRR=teamNRRused; bonusDisplayTotal=combo.total;

  document.getElementById('bonus-hero-value').textContent = bFmt$(combo.total);
  document.getElementById('bonus-hero-annual-value').textContent = bFmt$(combo.total*4);
  const splitEl=document.getElementById('bonus-hero-split');
  splitEl.style.display = r.valid ? 'grid' : 'none';
  set('bonus-half-ind', bFmt$(combo.individualHalf));
  set('bonus-half-team', bFmt$(combo.teamHalf));
  set('bonus-half-ind-sub', r.disqualified ? 'void — 2+ churns' : (`your ${r.appliedNRRTier.label} · ${r.multiplier}×`+(r.capped?' · capped':'')));
  const tTier=(teamNRRused!=null)?BonusCalc.selectNRRTier(teamNRRused).tier:null;
  set('bonus-half-team-sub', tTier ? `team ${bPct(teamNRRused)} · ${tTier.multiplier}×` : 'enter team NRR');
  const subEl=document.getElementById('bonus-hero-sub');
  if(!r.valid) subEl.textContent='Fix the highlighted input to calculate';
  else if(r.disqualified) subEl.textContent='Individual half void (2+ churns) — team half still applies';
  else if(r.quarterlyBonus===0 && r.bookTierStatus==='below-minimum') subEl.textContent='Book below the $50k minimum band';
  else subEl.textContent=`${bandLabel} band · 50% you + 50% team`;

  set('bo-band', bandLabel);
  set('bo-baseline', bFmt$(r.baselineBonus));
  set('bo-begin', bFmt$(r.beginningMRR));
  set('bo-end', bFmt$(r.endingExistingMRR));
  const netEl=document.getElementById('bo-net'); netEl.textContent=bFmt$(r.netExpansionMRR); netEl.className='bonus-out-value'+(r.netExpansionMRR<0?' coral':'');
  set('bo-cur', bPct(r.currentNRR));
  set('bo-applied', r.appliedNRRTier.label);
  set('bo-mult', r.multiplier+'×');
  set('bo-total', bFmt$(r.endingTotalManagedMRR));

  const sumEl=document.getElementById('bonus-summary');
  if(r.valid && r.beginningMRR>0){
    sumEl.style.display='';
    const teamPct=(teamNRRused!=null)?bPct(teamNRRused):'—';
    let s;
    if(r.disqualified){
      s=`<b>Individual half disqualified</b> — ${r.maxChurnsInMonth} customers churned in a single month (2+ voids it, regardless of expansion). You still earn the <b>team half of ${bFmt$(combo.teamHalf)}</b> (team NRR ${teamPct}), for a total of <b>${bFmt$(combo.total)}</b>.`;
    } else {
      s=`You're in the <b>${bandLabel}</b> band. Your NRR ${bPct(r.currentNRR)} earns an individual half of <b>${bFmt$(combo.individualHalf)}</b>`;
      if(r.capped) s+=` (held at the 6% ceiling)`;
      s+=`; the team's ${teamPct} NRR adds a team half of <b>${bFmt$(combo.teamHalf)}</b>. Total quarterly bonus <b>${bFmt$(combo.total)}</b> — a ${bFmt$(combo.total*4)} annualized run-rate.`;
    }
    sumEl.innerHTML=s;
  } else sumEl.style.display='none';

  bonusRenderProgress(r);
  bonusRenderExpansion(r);
}

// ── matrix (config-driven, capped) ─────────────────────────────
function bonusRenderMatrix(){
  const cfg=BonusCalc.DEFAULT_CONFIG;
  const nrrCols=cfg.nrrTiers.slice(1);
  const tiers=cfg.bookTiers;
  const rows=tiers.map((bt,bi)=>{
    const band=(bi<tiers.length-1)?`${bFmtK(bt.mrr)}–${bFmtK(tiers[bi+1].mrr)}`:`${bFmtK(bt.mrr)}+`;
    const cells=nrrCols.map(t=>{
      const gross=bt.baselineBonus*t.multiplier;
      const expansion=bt.mrr*(t.minimumNRR-1);
      const val=BonusCalc.capBonusToExpansion(gross, expansion, cfg);
      const capped=val<gross;
      const title=capped?` title="Capped at 6% of expansion (uncapped ${bFmtK(gross)})"`:'';
      return `<td class="${capped?'capd':''}" style="text-align:right"${title}>${bFmtK(val)}</td>`;
    }).join('');
    return `<tr><td class="book-col">${band}</td>${cells}</tr>`;
  }).join('');
  document.getElementById('bonus-matrix-body').innerHTML=rows;
}
function bonusRenderExpNeedMatrix(){
  const cfg=BonusCalc.DEFAULT_CONFIG;
  const nrrCols=cfg.nrrTiers.slice(1);
  const tiers=cfg.bookTiers;
  const rows=tiers.map((bt,bi)=>{
    const band=(bi<tiers.length-1)?`${bFmtK(bt.mrr)}–${bFmtK(tiers[bi+1].mrr)}`:`${bFmtK(bt.mrr)}+`;
    const cells=nrrCols.map(t=>`<td style="text-align:right">${bFmt$(BonusCalc.calculateExpansionRequiredForNRR(bt.mrr,t.minimumNRR))}</td>`).join('');
    return `<tr><td class="book-col">${band}</td>${cells}</tr>`;
  }).join('');
  document.getElementById('bonus-expneed-body').innerHTML=rows;
}

// ── next-milestone progress ────────────────────────────────────
function bonusRenderProgress(r){
  const box=document.getElementById('bonus-progress'), fill=document.getElementById('bonus-progress-fill'), note=document.getElementById('bonus-progress-note');
  if(!r.valid || r.disqualified){ box.style.display='none'; return; }
  box.style.display='';
  if(!r.next){ fill.style.width='100%'; note.innerHTML=`You're at the top tier — <b>${r.appliedNRRTier.label} NRR, ${r.multiplier}× multiplier</b>. 🎉`; return; }
  const cfg=BonusCalc.DEFAULT_CONFIG;
  const curMin=cfg.nrrTiers[r.appliedNRRTierIndex].minimumNRR||1.0;
  const nextMin=cfg.nrrTiers[r.appliedNRRTierIndex+1].minimumNRR;
  const frac=Math.max(0,Math.min(1,(r.currentNRR-curMin)/(nextMin-curMin)));
  fill.style.width=(frac*100).toFixed(0)+'%';
  const need=Math.max(0,r.next.additionalExpansionNeeded);
  note.innerHTML=`You're at <b>${bPct(r.currentNRR)}</b> quarterly NRR. Reaching the <b>${r.next.tierLabel} tier</b> needs about <b>${bFmt$(need)}</b> more net expansion this quarter — unlocking <b>+${bFmt$(r.next.additionalBonus)}</b> (total ${bFmt$(r.next.nextBonus)}) on the individual half.`;
}

// ── expansion-required table (personalized to entered cohort) ───
function bonusRenderExpansion(r){
  const cfg=BonusCalc.DEFAULT_CONFIG;
  const base=(r.beginningMRR>0)?r.beginningMRR:(r.avgManagedMRR>0?r.avgManagedMRR:(r.bookTier?r.bookTier.mrr:0));
  document.getElementById('bonus-exp-title').textContent = base>0 ? `Expansion needed to reach each bonus — your ${bFmt$(base)} cohort (110% = minimum to earn any bonus)` : 'Expansion needed to reach each bonus';
  const rows=cfg.nrrTiers.slice(1).map(t=>{
    const needed=BonusCalc.calculateExpansionRequiredForNRR(base,t.minimumNRR);
    const bonus=BonusCalc.capBonusToExpansion(r.baselineBonus*t.multiplier, needed, cfg);
    const hit=r.valid && r.appliedNRRTier && r.appliedNRRTier.label===t.label ? ' class="hit"' : '';
    return `<tr><td style="text-align:left"${hit}>${t.label}</td><td style="text-align:right"${hit}>${bFmt$(needed)}</td><td style="text-align:right"${hit}>${bFmt$(bonus)}</td></tr>`;
  }).join('');
  document.getElementById('bonus-exp-body').innerHTML=rows;
}

// ── reset / copy / print ───────────────────────────────────────
function bonusReset(){ bonusApply(Object.assign({mode:'simple'}, bonusExample)); bonusPersist(); bonusRecompute(); }
function bonusCopy(ev){
  const r=bonusLastResult; if(!r) return;
  const band=(r.bookTierStatus==='below-minimum'||!r.bookTier)?'Below $50k':bonusBandLabel(r.bookTier.mrr);
  const L=[];
  L.push('AM Quarterly Bonus');
  L.push('Book band: '+band+'   Baseline: '+bFmt$(r.baselineBonus));
  L.push('Beginning existing MRR: '+bFmt$(r.beginningMRR)+'   Ending existing MRR: '+bFmt$(r.endingExistingMRR));
  L.push('Net expansion: '+bFmt$(r.netExpansionMRR));
  L.push('Quarterly NRR: '+bPct(r.currentNRR)+'   Team NRR: '+(bonusLastTeamNRR!=null?bPct(bonusLastTeamNRR):'—'));
  if(bonusLastCombo){
    L.push('Individual half (50%): '+bFmt$(bonusLastCombo.individualHalf));
    L.push('Team half (50%): '+bFmt$(bonusLastCombo.teamHalf));
    L.push('QUARTERLY BONUS (total): '+bFmt$(bonusLastCombo.total)+'   (annualized run-rate '+bFmt$(bonusLastCombo.total*4)+')');
  }
  const txt=L.join('\n');
  const done=()=>{ const b=ev&&ev.currentTarget; if(b){ const o=b.textContent; b.textContent='Copied!'; setTimeout(()=>b.textContent=o,1400);} };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done,()=>{});
  else { const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); done(); }
}

// ── scenario comparison (persisted, max 3) ─────────────────────
function bonusGetScenarios(){ try{ return JSON.parse(localStorage.getItem(BONUS_SCEN_KEY))||[]; }catch(e){ return []; } }
function bonusSetScenarios(a){ try{ localStorage.setItem(BONUS_SCEN_KEY, JSON.stringify(a)); }catch(e){} }
function bonusSaveScenario(){
  const r=bonusLastResult; if(!r||!r.valid) return;
  const list=bonusGetScenarios();
  list.push({
    name:'Scenario '+(list.length+1),
    book:(r.bookTierStatus==='below-minimum'||!r.bookTier)?'Below $50k':bonusBandLabel(r.bookTier.mrr),
    cur:bPct(r.currentNRR), tier:r.appliedNRRTier.label, mult:r.multiplier,
    bonus:bonusDisplayTotal, annual:bonusDisplayTotal*4
  });
  while(list.length>3) list.shift();
  bonusSetScenarios(list); bonusRenderSlots();
}
function bonusDeleteScenario(i){ const list=bonusGetScenarios(); list.splice(i,1); bonusSetScenarios(list); bonusRenderSlots(); }
function bonusRenderSlots(){
  const list=bonusGetScenarios();
  const slots=[0,1,2].map(i=>{
    const s=list[i];
    if(!s) return `<div class="bonus-slot"><div class="bonus-slot-empty">Empty slot —<br>save a scenario to compare</div></div>`;
    return `<div class="bonus-slot filled">
      <div class="bonus-slot-name">${escapeHtml(s.name)}<button title="Remove" onclick="bonusDeleteScenario(${i})">×</button></div>
      <div class="bonus-slot-row"><span>Book band</span><b>${s.book}</b></div>
      <div class="bonus-slot-row"><span>Quarterly NRR</span><b>${s.cur}</b></div>
      <div class="bonus-slot-row"><span>Tier</span><b>${s.tier} · ${s.mult}×</b></div>
      <div class="bonus-slot-bonus">${bFmt$(s.bonus)}</div>
      <div class="bonus-slot-row" style="margin-top:4px"><span>Annualized</span><b>${bFmt$(s.annual)}</b></div>
    </div>`;
  }).join('');
  document.getElementById('bonus-scenario-slots').innerHTML=slots;
}
