// pulse-digital-twin.js
// ─────────────────────────────────────────────────────────────────
// Reads clinic specs from sessionStorage for realistic defaults.
// Simulation uses setTimeout (NOT async/await) — 100% reliable.
// Pre-fills fuel slider and NEPA from sessionStorage.
// All window.* at TOP LEVEL.
// ─────────────────────────────────────────────────────────────────

import { auth }               from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Clinic specs
var CLINIC = { genKva:20, tankL:200, loadW:2840, fuelPct:38, nepaOnline:false, protocol:'Routine' };

// ── Simulation parameters
var S = { fuel:38, nepaHrs:8, situation:'Routine', windowHrs:12, triage:'yes', smart:'yes' };

// ── Scenario history
var scenarioHistory = [
  { name:'Surgery + 25% fuel, NEPA off',   fuel:25, nepaHrs:12, situation:'Surgery',   windowHrs:12, triage:'yes', smart:'yes', risk:58, runtime:'2.5' },
  { name:'NEPA off 36h, full load',          fuel:38, nepaHrs:36, situation:'Routine',   windowHrs:36, triage:'no',  smart:'no',  risk:91, runtime:'1.1' },
  { name:'Delivery + 60% fuel, triage on',   fuel:60, nepaHrs:8,  situation:'Delivery',  windowHrs:12, triage:'yes', smart:'yes', risk:12, runtime:'6.2' },
];

var PRESETS = {
  'surgery-night':    { fuel:30, nepaHrs:12, situation:'Surgery',   windowHrs:12, triage:'yes', smart:'yes', query:'Surgery scheduled at 9 PM, NEPA offline all day, fuel at 30%' },
  'delivery-lowfuel': { fuel:18, nepaHrs:8,  situation:'Delivery',  windowHrs:8,  triage:'yes', smart:'yes', query:'Delivery in progress, only 18% fuel, no NEPA for 8 hours' },
  'nepa-36h':         { fuel:38, nepaHrs:36, situation:'Routine',   windowHrs:36, triage:'yes', smart:'yes', query:'NEPA stays offline for 36 hours straight' },
  'full-load':        { fuel:50, nepaHrs:16, situation:'Emergency', windowHrs:16, triage:'no',  smart:'no',  query:'Emergency situation, full ward load, no triage, manual control only' },
  'best-case':        { fuel:95, nepaHrs:0,  situation:'Routine',   windowHrs:12, triage:'yes', smart:'yes', query:'Best case: NEPA available, full tank, routine operations' },
};

// ══════════════════════════════════════════════════════════════════
// window.* — ALL called from HTML onclick / oninput
// ══════════════════════════════════════════════════════════════════

window.toggleSidebar = function() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sb-overlay')?.classList.toggle('open');
};
window.closeSidebar = function() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('open');
};
window.showToast = function(msg, type) {
  type = type || 'success';
  var t = document.getElementById('toast'); var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type; m.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(function() { t.classList.remove('show'); }, 3600);
};

window.updateParam = function(type, val) {
  val = parseInt(val);
  if (type === 'fuel') {
    S.fuel = val;
    var cls = val < 20 ? 'red' : val < 40 ? 'amber' : 'green';
    var el = document.getElementById('fuel-label');
    if (el) { el.textContent = val + '%'; el.className = 'param-val ' + cls; }
  }
  if (type === 'nepa') {
    S.nepaHrs = val;
    var cls2 = val > 24 ? 'red' : val > 12 ? 'amber' : 'white';
    var el2 = document.getElementById('nepa-label');
    if (el2) { el2.textContent = val === 0 ? 'NEPA available' : val + ' hrs'; el2.className = 'param-val ' + cls2; }
  }
  if (type === 'window') {
    S.windowHrs = val;
    var el3 = document.getElementById('window-label');
    if (el3) el3.textContent = val + ' hrs';
  }
};

window.selectPopt = function(el, groupId, cls) {
  document.getElementById(groupId)?.querySelectorAll('.popt').forEach(function(p) { p.className = 'popt'; });
  el.className = 'popt ' + cls;
  if (groupId === 'situation-opts') S.situation = el.dataset.val;
  if (groupId === 'triage-opts')    S.triage    = el.dataset.val;
  if (groupId === 'smart-opts')     S.smart     = el.dataset.val;
};

window.loadPreset = function(key) {
  var p = PRESETS[key];
  if (!p) return;
  S.fuel = p.fuel; S.nepaHrs = p.nepaHrs;
  S.situation = p.situation; S.windowHrs = p.windowHrs;
  S.triage = p.triage; S.smart = p.smart;
  var fs = document.getElementById('fuel-slider');
  var ns = document.getElementById('nepa-slider');
  var ws = document.getElementById('window-slider');
  var q  = document.getElementById('scenario-query');
  if (fs) fs.value = p.fuel;
  if (ns) ns.value = p.nepaHrs;
  if (ws) ws.value = p.windowHrs;
  if (q)  q.value  = p.query;
  window.updateParam('fuel',   p.fuel);
  window.updateParam('nepa',   p.nepaHrs);
  window.updateParam('window', p.windowHrs);
  document.querySelectorAll('.chip').forEach(function(c) { c.classList.remove('active'); });
  if (event && event.target) event.target.classList.add('active');
  setOptByVal('situation-opts', p.situation, p.situation === 'Routine' ? 'sel-green' : p.situation === 'Delivery' ? 'sel-amber' : 'sel-red');
  setOptByVal('triage-opts', p.triage, p.triage === 'yes' ? 'sel-green' : 'sel-red');
  setOptByVal('smart-opts',  p.smart,  p.smart  === 'yes' ? 'sel-green' : 'sel-amber');
  window.showToast('Preset loaded — click Run Simulation', 'info');
};

window.runSimulation = function() {
  // ── Read ALL slider + option values FIRST (synchronous DOM read)
  var fs = document.getElementById('fuel-slider');
  var ns = document.getElementById('nepa-slider');
  var ws = document.getElementById('window-slider');
  if (fs) S.fuel      = parseInt(fs.value);
  if (ns) S.nepaHrs   = parseInt(ns.value);
  if (ws) S.windowHrs = parseInt(ws.value);

  var sitSel = document.querySelector('#situation-opts .popt[class*="sel-"]');
  S.situation = sitSel ? (sitSel.dataset.val || 'Routine') : 'Routine';
  var triSel = document.querySelector('#triage-opts .popt[class*="sel-"]');
  S.triage    = triSel ? (triSel.dataset.val || 'yes') : 'yes';
  var smtSel = document.querySelector('#smart-opts .popt[class*="sel-"]');
  S.smart     = smtSel ? (smtSel.dataset.val || 'yes') : 'yes';

  // Parse natural language query to override params
  parseQuery();

  // UI loading state
  var btn   = document.getElementById('run-btn');
  var label = document.getElementById('run-label');
  var icon  = document.getElementById('run-icon');
  if (!btn) return;
  btn.classList.add('running'); btn.disabled = true;
  if (label) label.textContent = 'Simulating…';
  if (icon)  icon.innerHTML    = '<div class="btn-spin"></div>';

  // Use setTimeout — avoids any async issues
  setTimeout(function() {
    var result = computeSimulation();
    setProbGauge(result.risk);
    renderTimeline(result.events);
    renderRiskBars(result.riskBreakdown);
    renderRecommendations(result.recommendations);

    // Scenario label
    var labelEl  = document.getElementById('scenario-label');
    var labelTxt = document.getElementById('scenario-label-text');
    var sev = result.risk > 60 ? 'critical' : result.risk > 35 ? 'warning' : 'safe';
    if (labelEl)  labelEl.className = 'scenario-label ' + sev;
    if (labelTxt) labelTxt.textContent = S.situation + ' | ' + S.fuel + '% fuel | ' + S.nepaHrs + 'h NEPA | ' + S.windowHrs + 'h window — ' + result.risk + '% failure probability';

    var subEl = document.getElementById('timeline-sub');
    if (subEl) subEl.textContent = result.events.length + ' events over ' + S.windowHrs + 'h — Generator runtime: ' + result.runtime + 'h';

    // Show results
    var sec = document.getElementById('results-section');
    if (sec) {
      sec.classList.add('visible');
      setTimeout(function() { sec.scrollIntoView({ behavior:'smooth', block:'start' }); }, 100);
    }

    saveScenario(result);

    // Reset button
    btn.classList.remove('running'); btn.disabled = false;
    if (label) label.textContent = 'Run Simulation';
    if (icon)  icon.textContent  = '▶';

    window.showToast('Simulation complete — ' + result.risk + '% failure probability', result.risk > 60 ? 'error' : 'success');
  }, 1400);
};

window.toggleSection = function(id) {
  var header = document.querySelector('#sec-' + id + ' .ts-header');
  var body   = document.getElementById('body-' + id);
  if (header) header.classList.toggle('collapsed');
  if (body)   body.classList.toggle('hidden');
};

window.reloadScenario = function(i) {
  var s = scenarioHistory[i];
  if (!s) return;
  S.fuel = s.fuel; S.nepaHrs = s.nepaHrs;
  S.situation = s.situation; S.windowHrs = s.windowHrs;
  S.triage = s.triage; S.smart = s.smart;
  var fs = document.getElementById('fuel-slider');
  var ns = document.getElementById('nepa-slider');
  var ws = document.getElementById('window-slider');
  if (fs) fs.value = s.fuel;
  if (ns) ns.value = s.nepaHrs;
  if (ws) ws.value = s.windowHrs;
  window.updateParam('fuel',   s.fuel);
  window.updateParam('nepa',   s.nepaHrs);
  window.updateParam('window', s.windowHrs);
  setOptByVal('situation-opts', s.situation, s.situation === 'Routine' ? 'sel-green' : s.situation === 'Delivery' ? 'sel-amber' : 'sel-red');
  window.showToast('Scenario loaded — click Run Simulation', 'info');
};

window.toggleCompare = function() {
  var t = document.getElementById('compare-table');
  if (!t) return;
  t.classList.toggle('visible');
  if (t.classList.contains('visible')) refreshCompareTable();
};

// ══════════════════════════════════════════════════════════════════
// SIMULATION ENGINE — offline, no internet required
// ══════════════════════════════════════════════════════════════════

function computeSimulation() {
  var fuel      = S.fuel, nepaHrs = S.nepaHrs, sit = S.situation;
  var winHrs    = S.windowHrs, triage = S.triage, smart = S.smart;
  var tankL     = CLINIC.tankL, genKva = CLINIC.genKva;
  var fuelL     = (fuel / 100) * tankL;
  var fph       = genKva * 0.25;
  var fullLoadKw= CLINIC.loadW / 1000;
  var critLoadKw= 1.14;
  var triActive = triage === 'yes';
  var activeLoad= triActive ? (sit === 'Routine' ? fullLoadKw * 0.75 : critLoadKw) : fullLoadKw;
  var adjFph    = fph * Math.max(0.2, activeLoad / (genKva * 0.8));
  var baseRt    = fuelL / adjFph;

  var fuelRisk  = fuel < 20 ? 85 : fuel < 40 ? 50 : fuel < 60 ? 25 : 10;
  var nepaRisk  = nepaHrs > 24 ? 80 : nepaHrs > 12 ? 50 : nepaHrs > 6 ? 30 : nepaHrs === 0 ? 0 : 15;
  var sitRisk   = sit === 'Emergency' ? 80 : sit === 'Surgery' ? 65 : sit === 'Delivery' ? 45 : 15;
  var triBon    = triActive ? -20 : 0;
  var smtBon    = smart === 'yes' ? -8 : 0;
  var winRisk   = winHrs > baseRt ? 40 : winHrs > baseRt * 0.8 ? 20 : 5;
  var raw       = fuelRisk*0.3 + nepaRisk*0.25 + sitRisk*0.25 + winRisk*0.2;
  var finalRisk = Math.round(Math.max(3, Math.min(97, raw + triBon + smtBon)));

  var startT = new Date();
  var events = [];
  function fuelAt(h) { return Math.max(0, fuel - (adjFph * h / tankL * 100)); }
  function ts(h) {
    var t = new Date(startT.getTime() + h * 3600000);
    return t.getHours().toString().padStart(2,'0') + ':' + t.getMinutes().toString().padStart(2,'0');
  }

  events.push({ time:ts(0), type:'ok', title:'Simulation Start', desc:'Generator at ' + fuel + '% (' + Math.round(fuelL) + 'L). ' + (nepaHrs === 0 ? 'NEPA available.' : 'NEPA offline.') + ' ' + sit + ' protocol ' + (triActive ? 'with PULSE triage active.' : 'manual control only.'), fuel:fuel });

  if (nepaHrs > 0 && nepaHrs < winHrs) {
    events.push({ time:ts(nepaHrs), type:'info', title:'NEPA Supply Restored', desc:'Grid power returns after ' + nepaHrs + ' hours. Generator switches to standby. Fuel conservation begins.', fuel:fuelAt(nepaHrs) });
  }
  var warnT = (fuelL - tankL*0.25) / adjFph;
  if (warnT > 0 && warnT < winHrs) {
    events.push({ time:ts(warnT), type:'warn', title:'Fuel Warning — 25% Threshold', desc:triActive ? 'PULSE automatically reduces non-critical loads.' : 'Manual intervention required — consider cutting non-essential devices.', fuel:25 });
  }
  var critT = (fuelL - tankL*0.10) / adjFph;
  if (critT > 0 && critT < winHrs) {
    events.push({ time:ts(critT), type:'crit', title:'Critical Fuel — 10% Threshold', desc:sit !== 'Routine' ? sit + ' still in progress. Immediate fuel procurement required.' : 'Order fuel immediately.', fuel:10 });
  }
  if (baseRt < winHrs) {
    events.push({ time:ts(baseRt), type:'crit', title:'Generator Stops', desc:'Fuel exhausted after ' + baseRt.toFixed(1) + ' hours.' + (sit !== 'Routine' ? ' ' + sit + ' in progress — CRITICAL.' : '') + ' UPS provides ~37 min for life-critical devices.', fuel:0 });
  } else {
    events.push({ time:ts(winHrs), type:'ok', title:'End of ' + winHrs + '-Hour Window', desc:'Generator still running at ' + fuelAt(winHrs).toFixed(0) + '% fuel. No failure within this period.', fuel:fuelAt(winHrs) });
  }

  var risks = [
    { label:'Fuel level risk',      val:Math.round(fuelRisk), colour:fuelRisk>60?'var(--red)':fuelRisk>35?'var(--amber)':'var(--g1)' },
    { label:'NEPA outage duration', val:Math.round(nepaRisk), colour:nepaRisk>60?'var(--red)':nepaRisk>35?'var(--amber)':'var(--g1)' },
    { label:'Clinical situation',   val:Math.round(sitRisk),  colour:sitRisk >60?'var(--red)':sitRisk >35?'var(--amber)':'var(--g1)' },
    { label:'Window vs. runtime',   val:Math.round(winRisk),  colour:winRisk >30?'var(--red)':'var(--amber)' },
  ];

  var recs = [];
  if (fuel < 40)       recs.push('Order fuel now — target 80%+ before end of day');
  if (!triActive)      recs.push('Activate PULSE triage to extend runtime by ~' + (baseRt * 0.4).toFixed(1) + ' hours');
  if (smart !== 'yes') recs.push('Install smart switches for automatic load shedding');
  if (nepaHrs > 12)    recs.push('Contact your DisCo to report the extended outage');
  if (finalRisk > 60)  recs.push('Consider postponing non-emergency procedures until fuel is resupplied');
  if (recs.length === 0) recs.push('Current setup is within safe operating parameters for this scenario');

  return { risk:finalRisk, runtime:baseRt.toFixed(1), events:events, riskBreakdown:risks, recommendations:recs };
}

// ── Natural language query parser
function parseQuery() {
  var q = (document.getElementById('scenario-query') || {}).value || '';
  q = q.toLowerCase();
  if (!q.trim()) return;
  var fm = q.match(/(\d+)\s*%?\s*(fuel|petrol|diesel|tank)/);
  if (fm) { var f = parseInt(fm[1]); if (f >= 5 && f <= 100) { S.fuel = f; var fs = document.getElementById('fuel-slider'); if (fs) { fs.value = f; window.updateParam('fuel', f); } } }
  var nm = q.match(/(\d+)\s*(hour|hr|h)\s*(outage|offline|off|without|nepa)/);
  var nm2= q.match(/(nepa|power)\s*(off|out|gone)\s*(for\s*)?(\d+)\s*(hour|hr|h)/);
  var n  = nm ? parseInt(nm[1]) : nm2 ? parseInt(nm2[4]) : null;
  if (n != null && n >= 0 && n <= 48) { S.nepaHrs = n; var ns = document.getElementById('nepa-slider'); if (ns) { ns.value = n; window.updateParam('nepa', n); } }
  if (q.includes('surgery') || q.includes('operation') || q.includes('theatre'))   { S.situation = 'Surgery';   setOptByVal('situation-opts','Surgery','sel-red');   }
  else if (q.includes('deliver') || q.includes('labour') || q.includes('maternity')){ S.situation = 'Delivery';  setOptByVal('situation-opts','Delivery','sel-amber'); }
  else if (q.includes('emergency') || q.includes('resus'))                          { S.situation = 'Emergency'; setOptByVal('situation-opts','Emergency','sel-red');  }
}

function setProbGauge(pct) {
  var arcLen = 251;
  var offset = arcLen - (pct / 100) * arcLen;
  var fill   = document.getElementById('pg-fill');
  var num    = document.getElementById('pg-num');
  var lbl    = document.getElementById('pg-label');
  var desc   = document.getElementById('pg-desc');
    var cls    = pct > 60 ? 'high' : pct > 35 ? 'moderate' : 'safe';
  var lbls   = { safe:'LOW RISK', moderate:'MODERATE RISK', high:'HIGH RISK' };
  var descs  = { safe:'This scenario is manageable with current precautions.', moderate:'Significant risk. Action recommended before this occurs.', high:'Critical risk. Immediate intervention required.' };
  
  if (fill) { 
    // Use setAttribute or classList instead of .className
    fill.setAttribute('class', 'pg-arc-fill ' + cls); 
    fill.style.strokeDashoffset = offset; 
  }
  if (num)  { 
    num.setAttribute('class', 'pg-num ' + cls); 
    num.innerHTML = pct + '<span class="pg-pct">%</span>'; 
  }
  
  if (lbl)  lbl.textContent  = lbls[cls];
  if (desc) desc.textContent = descs[cls];
}

function renderTimeline(events) {
  var wrap = document.getElementById('timeline-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  events.forEach(function(ev, i) {
    var cc  = ev.type === 'ok' ? 'ok' : ev.type === 'warn' ? 'warn' : ev.type === 'crit' ? 'crit' : 'info';
    var bgc = ev.type === 'ok' ? 'ok-bg' : ev.type === 'warn' ? 'warn-bg' : ev.type === 'crit' ? 'crit-bg' : '';
    var fc  = (ev.fuel||0) > 40 ? 'var(--g1)' : (ev.fuel||0) > 20 ? 'var(--amber)' : 'var(--red)';
    var bar = ev.fuel != null ? '<div class="tl-fuel-bar"><div class="tl-fuel-track"><div class="tl-fuel-fill" style="width:' + (ev.fuel||0) + '%;background:' + fc + ';transition:width 1s ' + (0.3+i*0.1) + 's ease"></div></div></div>' : '';
    wrap.innerHTML += '<div class="timeline-item"><div class="tl-time-col"><div class="tl-circle ' + cc + '">' + (i+1) + '</div><div class="tl-time-label">' + ev.time + '</div></div><div class="tl-content ' + bgc + '"><div class="tl-event-title">' + ev.title + '</div><div class="tl-event-desc">' + ev.desc + '</div>' + bar + '</div></div>';
  });
}

function renderRiskBars(risks) {
  var wrap = document.getElementById('risk-bars');
  if (!wrap) return;
  wrap.innerHTML = risks.map(function(r) {
    return '<div class="rb-item"><div class="rb-label"><span>' + r.label + '</span><strong>' + r.val + '%</strong></div><div class="rb-track"><div class="rb-fill" style="width:0%;background:' + r.colour + ';transition:width 1.2s ease" data-target="' + r.val + '%"></div></div></div>';
  }).join('');
  requestAnimationFrame(function() { requestAnimationFrame(function() { wrap.querySelectorAll('.rb-fill').forEach(function(el) { el.style.width = el.dataset.target; }); }); });
}

function renderRecommendations(recs) {
  var el = document.getElementById('rec-items');
  if (!el) return;
  el.innerHTML = recs.map(function(r) { return '<div class="rec-item"><div class="rec-dot"></div><span>' + r + '</span></div>'; }).join('');
}

function saveScenario(result) {
  scenarioHistory.unshift({ name:S.situation + ' | ' + S.fuel + '% fuel | ' + S.nepaHrs + 'h NEPA', fuel:S.fuel, nepaHrs:S.nepaHrs, situation:S.situation, windowHrs:S.windowHrs, triage:S.triage, smart:S.smart, risk:result.risk, runtime:result.runtime });
  if (scenarioHistory.length > 6) scenarioHistory.pop();
  refreshSavedList();
}

function refreshSavedList() {
  var list = document.getElementById('saved-list');
  if (!list) return;
  list.innerHTML = scenarioHistory.slice(0,4).map(function(s, i) {
    var col = s.risk > 60 ? 'var(--red)' : s.risk > 35 ? 'var(--amber)' : 'var(--g1)';
    return '<div class="saved-item" onclick="reloadScenario(' + i + ')"><div class="si-dot" style="background:' + col + '"></div><div class="si-body"><div class="si-title">' + s.name + '</div><div class="si-meta">' + (i===0?'Just now':i===1?'2 sims ago':i+' sims ago') + '</div></div><div class="si-risk" style="color:' + col + '">' + s.risk + '%</div></div>';
  }).join('');
}

function refreshCompareTable() {
  var rows = document.getElementById('compare-rows');
  if (!rows) return;
  rows.innerHTML = scenarioHistory.slice(0,5).map(function(s) {
    var col = s.risk > 60 ? 'var(--red)' : s.risk > 35 ? 'var(--amber)' : 'var(--g1)';
    return '<div class="ct-row" style="grid-template-columns:1.5fr 0.7fr 0.8fr"><span class="ct-scenario-name">' + s.name + '</span><span class="ct-prob" style="color:' + col + '">' + s.risk + '%</span><span class="ct-runtime">' + s.runtime + 'h</span></div>';
  }).join('');
}

function setOptByVal(groupId, val, cls) {
  document.getElementById(groupId)?.querySelectorAll('.popt').forEach(function(el) {
    el.className = 'popt' + (el.dataset.val === val ? ' ' + cls : '');
  });
}

function updateVitalsMini() {
  var rows = document.querySelectorAll('.vm-row');
  if (rows.length < 5) return;
  var fuelL   = Math.round(CLINIC.fuelPct * CLINIC.tankL / 100);
  var nepaOff = !CLINIC.nepaOnline ? 'Offline' : 'Online';
  var nepaStr = sessionStorage.getItem('pulse_nepa_off_start') && !CLINIC.nepaOnline
    ? 'Offline ' + ((Date.now() - parseInt(sessionStorage.getItem('pulse_nepa_off_start'))) / 3600000).toFixed(1) + 'h'
    : nepaOff;
  var vals = [CLINIC.fuelPct + '% (' + fuelL + 'L)', nepaStr, CLINIC.fridgeTemp.toFixed(1) + '°C — ' + (CLINIC.fridgeTemp <= 8 ? 'Safe' : 'HIGH'), CLINIC.loadW.toLocaleString() + 'W', CLINIC.protocol];
  rows.forEach(function(row, i) {
    var valEl = row.querySelector('.vm-val');
    if (valEl && vals[i] !== undefined) valEl.textContent = vals[i];
  });
}

function startClock() {
  function tick() { var n = new Date(); var el = document.getElementById('live-clock'); if (el) el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0'); }
  tick(); setInterval(tick, 10000);
}

function loadClinicData() {
  var cached = sessionStorage.getItem('pulse_clinic');
  if (!cached) return;
  try {
    var d = JSON.parse(cached);
    if (d.generatorKva) CLINIC.genKva  = parseFloat(d.generatorKva);
    if (d.tankLitres)   CLINIC.tankL   = parseFloat(d.tankLitres);
    if (d.clinicName) {
      var cpName = document.querySelector('.cp-name');
      if (cpName) cpName.textContent = d.clinicName;
    }
    if (d.lga || d.state) {
      var cpMeta = document.querySelector('.cp-meta');
      if (cpMeta) cpMeta.textContent = (d.lga || '') + ', ' + (d.state || '') + ' · ' + (d.facilityType || 'PHC');
    }
    if (d.liveReadings) {
      var r = d.liveReadings;
      CLINIC.fuelPct    = r.fuelPct    ?? CLINIC.fuelPct;
      CLINIC.fridgeTemp = r.fridgeTemp ?? CLINIC.fridgeTemp;
      CLINIC.loadW      = r.loadW      ?? CLINIC.loadW;
      CLINIC.nepaOnline = r.nepaOnline ?? CLINIC.nepaOnline;
      CLINIC.protocol   = r.protocol   || CLINIC.protocol;
    }
  } catch(e) {}

  // NEPA from sessionStorage
  var ns = sessionStorage.getItem('pulse_nepa_online');
  if (ns !== null) CLINIC.nepaOnline = ns === 'true';
  var fp = sessionStorage.getItem('pulse_fuel_pct');
  if (fp) CLINIC.fuelPct = parseInt(fp);

  // Set slider defaults to real values
  S.fuel    = CLINIC.fuelPct;
  S.nepaHrs = CLINIC.nepaOnline ? 0 : 8;

  var fs = document.getElementById('fuel-slider');
  if (fs) { fs.value = S.fuel; window.updateParam('fuel', S.fuel); }
  var ns2 = document.getElementById('nepa-slider');
  if (ns2) { ns2.value = S.nepaHrs; window.updateParam('nepa', S.nepaHrs); }
  updateVitalsMini();
}

onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);
});

document.addEventListener('DOMContentLoaded', function() {
  startClock();
  loadClinicData();
  window.updateParam('window', S.windowHrs);
});