// pulse-triage.js
// ─────────────────────────────────────────────────────────────────
// Reads scenario from sessionStorage (set by pulse-crisis.js).
// Loads real appliance list from Firebase for this clinic.
// Runs the offline triage engine — no internet required.
// Writes confirmed protocol log to Firebase.
// All window.* at TOP LEVEL.
// ─────────────────────────────────────────────────────────────────

import { auth }                          from './firebase-config.js';
import { getDatabase, ref, get, set }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }            from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── Scenario (read from sessionStorage)
var scenario = {
  situation: 'Delivery in Progress',
  fuelPct:   38,
  nepaOnline: false,
  wards:     ['Delivery Room', 'Maternity Ward'],
};

// ── Clinic specs (from Firebase)
var tankLitres   = 200;
var genKva       = 20;
var appliances   = [];   // loaded from Firebase
var countdownSec = 0;
var countdownInterval = null;

// ── Fallback appliance list (used if Firebase is empty)
var DEFAULT_APPLIANCES = [
  { id:1,  name:'Vaccine Refrigerator',    ward:'Pharmacy',         priority:'critical', watts:80,   smart:true,  qty:1 },
  { id:2,  name:'Oxygen Concentrator',     ward:'Delivery Room',    priority:'critical', watts:300,  smart:false, qty:2 },
  { id:3,  name:'Fetal Heart Monitor',     ward:'Delivery Room',    priority:'critical', watts:15,   smart:false, qty:1 },
  { id:4,  name:'Surgical Theatre Lights', ward:'Operating Theatre',priority:'critical', watts:300,  smart:false, qty:3 },
  { id:5,  name:'Delivery Room Lighting',  ward:'Delivery Room',    priority:'critical', watts:80,   smart:false, qty:1 },
  { id:6,  name:'Autoclave / Steriliser',  ward:'Theatre',          priority:'important',watts:2000, smart:true,  qty:1 },
  { id:7,  name:'Corridor Lighting',       ward:'General',          priority:'important',watts:160,  smart:false, qty:1 },
  { id:8,  name:'Maternity Ward Fan',      ward:'Maternity Ward',   priority:'important',watts:120,  smart:true,  qty:1 },
  { id:9,  name:'Staff Room AC',           ward:'Staff Room',       priority:'standard', watts:1100, smart:true,  qty:1 },
  { id:10, name:'Admin Computers',         ward:'Admin',            priority:'standard', watts:400,  smart:true,  qty:1 },
  { id:11, name:'Phone Charging Stations', ward:'Admin',            priority:'standard', watts:150,  smart:false, qty:1 },
  { id:12, name:'Reception Television',    ward:'Reception',        priority:'standard', watts:120,  smart:false, qty:1 },
];

// ══════════════════════════════════════════════════════════════════
// window.* — ALL called from HTML onclick
// ══════════════════════════════════════════════════════════════════

window.toggleSidebar = function() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
};

window.closeSidebar = function() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
};

window.showToast = function(msg, type) {
  type = type || 'success';
  var t = document.getElementById('toast');
  var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type;
  m.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 3600);
};

window.toggleSection = function(id) {
  var header = document.querySelector('#sec-' + id + ' .ts-header');
  var body   = document.getElementById('body-' + id);
  if (header) header.classList.toggle('collapsed');
  if (body)   body.classList.toggle('hidden');
};

window.toggleDevice = function(id, btn) {
  var app = appliances.find(function(a) { return a.id == id; });
  if (!btn) return;
  if (btn.classList.contains('on'))  { btn.className = 'device-switch off'; window.showToast((app ? app.name : 'Device') + ' — manually turned off', 'info'); }
  else                               { btn.className = 'device-switch on';  window.showToast((app ? app.name : 'Device') + ' — manually turned on', 'success'); }
  if (app && app.smart) window.showToast('Smart switch command sent', 'success');
};

window.confirmProtocol = function() {
  var uid = sessionStorage.getItem('pulse_uid');
  if (!uid) { window.showToast('Protocol saved locally', 'success'); return; }

  var key = 'protocol_' + Date.now();
  set(ref(db, 'clinics/' + uid + '/protocolLogs/' + key), {
    situation:  scenario.situation,
    fuelPct:    scenario.fuelPct,
    nepaOnline: scenario.nepaOnline,
    wards:      scenario.wards,
    timestamp:  Date.now(),
    confirmed:  true,
  }).then(function() {
    window.showToast('Protocol confirmed and logged to Firebase', 'success');
  }).catch(function() {
    window.showToast('Protocol saved — will sync when online', 'info');
  });
};

// ══════════════════════════════════════════════════════════════════
// OFFLINE TRIAGE ENGINE
// ══════════════════════════════════════════════════════════════════

function mapPriority(p) {
  // Normalise priority strings from Firebase to engine values
  p = (p || '').toLowerCase();
  if (p.includes('critical') || p.includes('life')) return 'critical';
  if (p.includes('import'))                         return 'important';
  return 'standard';
}

function computeTriage(appList, sit, fuelPct, nepaOn, activeWards) {
  var isDelivery  = sit === 'Delivery in Progress';
  var isSurgery   = sit === 'Active Surgery';
  var isEmergency = sit === 'Emergency';
  var fuelLow     = fuelPct < 40;
  var fuelCrit    = fuelPct < 20;

  return appList.map(function(app) {
    var priority = mapPriority(app.priority);
    var inWard   = activeWards.length === 0 || activeWards.some(function(w) {
      return (app.ward || '').toLowerCase().includes(w.toLowerCase());
    }) || app.ward === 'General' || app.ward === 'Pharmacy';

    var decision = 'on';

    if (priority === 'critical') {
      decision = 'on'; // never cut life-critical
    } else if (priority === 'important') {
      if (fuelCrit)                    decision = 'off';
      else if (fuelLow || !inWard)     decision = 'reduce';
      else                             decision = 'on';
    } else {
      // standard
      if (isDelivery || isSurgery || isEmergency) decision = 'off';
      else if (fuelLow)                           decision = 'off';
      else                                        decision = 'reduce';
    }

    // Overrides
    var n = (app.name || '').toLowerCase();
    if (n.includes('vaccine') || n.includes('fridge') || n.includes('refrigerator')) decision = 'on';
    if ((n.includes('air con') || n.includes('ac unit') || n.includes(' ac')) && (isDelivery || isSurgery || isEmergency)) decision = 'off';
    if (n.includes('tv') || n.includes('television')) decision = 'off';
    if (n.includes('steriliser') || n.includes('autoclave')) {
      if (!isSurgery && fuelLow) decision = 'off';
    }

    var qty = parseInt(app.qty) || 1;
    var w   = parseInt(app.watts) || 0;
    return Object.assign({}, app, {
      priority:      priority,
      decision:      decision,
      effectiveWatts:w * qty,
      reducedWatts:  Math.round(w * qty * 0.4),
    });
  });
}

function calcRuntime(triageList) {
  var fuelL    = scenario.fuelPct * tankLitres / 100;
  var fph      = genKva * 0.25;
  var fullLoad = appliances.reduce(function(s,a) { return s + (parseInt(a.watts)||0) * (parseInt(a.qty)||1); }, 0);
  var triLoad  = triageList.reduce(function(s,d) {
    return s + (d.decision === 'on' ? d.effectiveWatts : d.decision === 'reduce' ? d.reducedWatts : 0);
  }, 0);

  // Estimate generator fuel burn relative to kVA rating
  var fullBurn   = fph;
  var triageBurn = fph * Math.max(0.2, triLoad / Math.max(1, fullLoad));

  var fullHrs   = (fuelL / fullBurn).toFixed(1);
  var triageHrs = (fuelL / triageBurn).toFixed(1);
  var saved     = (parseFloat(triageHrs) - parseFloat(fullHrs)).toFixed(1);

  return { fullHrs: fullHrs, triageHrs: triageHrs, saved: saved, triLoad: triLoad };
}

// ══════════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════════

function renderSection(sectionId, devices, type) {
  var body      = document.getElementById('body-' + sectionId);
  var countEl   = document.getElementById('count-' + sectionId);
  var totalEl   = document.getElementById('total-' + sectionId);
  if (!body) return;

  var filtered  = devices.filter(function(d) { return d.decision === type; });
  if (countEl) countEl.textContent = filtered.length + ' device' + (filtered.length !== 1 ? 's' : '');

  var totalW = filtered.reduce(function(s,d) {
    return s + (type === 'reduce' ? d.reducedWatts : d.effectiveWatts);
  }, 0);
  if (totalEl) totalEl.textContent = totalW.toLocaleString() + 'W';

  body.innerHTML = '';
  filtered.forEach(function(d) {
    var priorityCls  = d.priority === 'critical'  ? 'dp-critical' : d.priority === 'important' ? 'dp-important' : 'dp-standard';
    var switchCls    = type === 'on' ? 'on' : type === 'reduce' ? 'reduce' : 'off';
    var displayW     = type === 'reduce' ? d.reducedWatts : d.effectiveWatts;
    var origW        = d.effectiveWatts;
    var smartBadge   = d.smart ? '<span class="device-smart-badge">Smart</span>' : '';
    var reducedNote  = type === 'reduce' ? ' &middot; Reduced from ' + origW + 'W' : '';
    var priorityLabel= d.priority.charAt(0).toUpperCase() + d.priority.slice(1);

    body.innerHTML += '<div class="device-row">'
      + '<div class="device-priority-bar ' + priorityCls + '"></div>'
      + '<div class="device-info">'
      + '<div class="device-name">' + d.name + (parseInt(d.qty) > 1 ? ' &times;' + d.qty : '') + '</div>'
      + '<div class="device-meta">' + (d.ward || '') + ' &middot; ' + priorityLabel + reducedNote + '</div>'
      + '</div>'
      + '<div class="device-watts">' + displayW.toLocaleString() + 'W<small>' + (type === 'reduce' ? 'reduced' : 'full load') + '</small></div>'
      + smartBadge
      + '<button class="device-switch ' + switchCls + '" onclick="toggleDevice(' + d.id + ', this)" title="' + (d.smart ? 'Smart switch connected' : 'Manual control required') + '"></button>'
      + '</div>';
  });
}

function renderRuntimeHero(rt) {
  var before = document.getElementById('rh-before');
  var after  = document.getElementById('rh-after');
  var pill   = document.getElementById('rh-saved-pill');
  var bPct   = document.getElementById('rh-b-pct');
  var aBefore= document.getElementById('rh-bar-before');
  var aAfter = document.getElementById('rh-bar-after');

  if (before) before.textContent = rt.fullHrs + 'h';
  if (after)  after.textContent  = rt.triageHrs + 'h';
  if (pill)   pill.innerHTML     = '&#43; ' + rt.saved + ' hours saved' + (scenario.situation === 'Delivery in Progress' ? ' — enough to complete the delivery safely' : ' by PULSE triage');

  var beforePct = Math.round((parseFloat(rt.fullHrs) / Math.max(0.1, parseFloat(rt.triageHrs))) * 100);
  if (bPct)   bPct.textContent  = beforePct + '%';
  if (aBefore) aBefore.style.width = beforePct + '%';
  if (aAfter)  { aAfter.style.width = '0%'; setTimeout(function() { aAfter.style.width = '100%'; }, 300); }
}

function renderProtocolBand(rt, triageList) {
  var band     = document.getElementById('protocol-band');
  var pbIcon   = document.getElementById('pb-icon');
  var pbMode   = document.getElementById('pb-mode');
  var pbTitle  = document.getElementById('pb-title');
  var pbMeta   = document.getElementById('pb-meta');
  var pbRuntime= document.getElementById('pb-runtime');
  var pbSaved  = document.getElementById('pb-saved');
  var pbLoad   = document.getElementById('pb-critical-load');
  var pbTime   = document.getElementById('pb-time');
  var topSub   = document.getElementById('topbar-sub');

  var isCrit = scenario.situation === 'Emergency' || scenario.situation === 'Active Surgery';
  var isWarn = scenario.situation === 'Delivery in Progress' || scenario.fuelPct < 25;
  var sev    = isCrit ? 'sev-critical' : isWarn ? 'sev-warning' : 'sev-routine';

  if (band)    band.className = 'protocol-band ' + sev;
  if (pbIcon)  { pbIcon.textContent = isCrit ? '!' : isWarn ? '!' : 'P'; }
  if (pbMode)  pbMode.textContent   = isCrit ? 'CRITICAL PROTOCOL ACTIVE' : isWarn ? 'WARNING PROTOCOL ACTIVE' : 'ROUTINE PROTOCOL ACTIVE';
  if (pbTitle) pbTitle.textContent  = scenario.situation + ' — Energy Triage Mode';

  var now = new Date();
  var ts  = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  if (pbTime)  pbTime.textContent  = ts;
  if (pbMeta) {
    pbMeta.innerHTML = 'Activated at <span id="pb-time">' + ts + '</span> &nbsp;&#183;&nbsp; Fuel: '
      + scenario.fuelPct + '% &nbsp;&#183;&nbsp; NEPA: ' + (scenario.nepaOnline ? 'Online' : 'Offline')
      + ' &nbsp;&#183;&nbsp; ' + scenario.wards.length + ' ward' + (scenario.wards.length !== 1 ? 's' : '') + ' active';
  }
  if (pbRuntime) pbRuntime.textContent = rt.triageHrs + 'h';
  if (pbSaved)   pbSaved.textContent   = '+' + rt.saved + 'h';

  var critLoad = triageList.filter(function(d) { return d.decision === 'on'; }).reduce(function(s,d) { return s + d.effectiveWatts; }, 0);
  if (pbLoad) pbLoad.textContent = critLoad.toLocaleString() + 'W';

  if (topSub) topSub.textContent = scenario.situation + ' · ' + scenario.fuelPct + '% fuel · ' + scenario.wards.length + ' ward' + (scenario.wards.length !== 1 ? 's' : '');
}

function renderSituationPanel(rt) {
  var ssSit     = document.getElementById('ss-situation');
  var ssFuel    = document.getElementById('ss-fuel');
  var ssNepa    = document.getElementById('ss-nepa');
  var ssWards   = document.getElementById('ss-wards');

  if (ssSit) {
    ssSit.textContent = scenario.situation;
    ssSit.className   = 'sc-val ' + (scenario.situation === 'Emergency' || scenario.situation === 'Active Surgery' ? 'red' : scenario.situation === 'Delivery in Progress' ? 'amber' : 'green');
  }
  if (ssFuel) {
    var fuelL = Math.round(scenario.fuelPct * tankLitres / 100);
    ssFuel.textContent = scenario.fuelPct + '% (' + fuelL + 'L)';
    ssFuel.className   = 'sc-val ' + (scenario.fuelPct < 20 ? 'red' : scenario.fuelPct < 40 ? 'amber' : 'green');
  }
  if (ssNepa) {
    var nepaOffStart = sessionStorage.getItem('pulse_nepa_off_start');
    var offHrs = nepaOffStart ? ((Date.now() - parseInt(nepaOffStart)) / 3600000).toFixed(1) : '—';
    ssNepa.textContent = scenario.nepaOnline ? 'Available' : 'Offline — ' + offHrs + 'h';
    ssNepa.className   = 'sc-val ' + (scenario.nepaOnline ? 'green' : 'red');
  }
  if (ssWards) {
    ssWards.textContent = scenario.wards.length > 0 ? scenario.wards.join(', ') : 'None specified';
  }
}

// ── Countdown timer
function startCountdown(triageHrs) {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownSec = Math.round(parseFloat(triageHrs) * 3600);
  var total    = countdownSec;
  var timerEl  = document.getElementById('fc-timer');
  var barEl    = document.getElementById('fc-bar-fill');

  function tick() {
    if (countdownSec <= 0) { if (timerEl) timerEl.textContent = '0:00:00'; clearInterval(countdownInterval); return; }
    countdownSec--;
    var h = Math.floor(countdownSec / 3600);
    var m = Math.floor((countdownSec % 3600) / 60);
    var s = countdownSec % 60;
    if (timerEl) {
      timerEl.textContent = h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
      timerEl.className   = 'fc-timer ' + (countdownSec < 3600 ? 'red' : countdownSec < 7200 ? 'amber' : '');
    }
    if (barEl) barEl.style.width = ((countdownSec / total) * 100) + '%';
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ── Clock
function startClock() {
  function tick() {
    var n = new Date();
    var el = document.getElementById('live-clock');
    if (el) el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
  }
  tick(); setInterval(tick, 10000);
}

// ── Main: load clinic data from Firebase then run triage engine
function loadAndRender(uid) {
  // Read scenario from sessionStorage
  scenario.situation  = sessionStorage.getItem('pulse_situation') || 'Delivery in Progress';
  scenario.fuelPct    = parseInt(sessionStorage.getItem('pulse_fuel_pct') || '38');
  scenario.nepaOnline = sessionStorage.getItem('pulse_nepa') === 'true';
  try { scenario.wards = JSON.parse(sessionStorage.getItem('pulse_wards') || '[]'); } catch(e) { scenario.wards = []; }

  // Read clinic specs from sessionStorage cache (fast)
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try {
      var c = JSON.parse(cached);
      if (c.tankLitres)   tankLitres = parseFloat(c.tankLitres);
      if (c.generatorKva) genKva     = parseFloat(c.generatorKva);
    } catch(e) {}
  }

  // Try to load real appliances from Firebase
  get(ref(db, 'clinics/' + uid + '/appliances')).then(function(snap) {
    if (snap.exists()) {
      appliances = Object.values(snap.val()).map(function(a, i) {
        return Object.assign({ id: i+1 }, a);
      });
    } else {
      appliances = DEFAULT_APPLIANCES;
    }

    // Assign sequential IDs if missing
    appliances.forEach(function(a, i) { if (!a.id) a.id = i+1; });

    runTriage();
  }).catch(function() {
    appliances = DEFAULT_APPLIANCES;
    runTriage();
  });
}

function runTriage() {
  var triageList = computeTriage(appliances, scenario.situation, scenario.fuelPct, scenario.nepaOnline, scenario.wards);
  var rt         = calcRuntime(triageList);

  renderSection('on',     triageList, 'on');
  renderSection('reduce', triageList, 'reduce');
  renderSection('off',    triageList, 'off');

  renderRuntimeHero(rt);
  renderProtocolBand(rt, triageList);
  renderSituationPanel(rt);
  startCountdown(rt.triageHrs);
}

// ── Auth guard
onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);
  loadAndRender(user.uid);
});

document.addEventListener('DOMContentLoaded', function() {
  startClock();
});