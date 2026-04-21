// pulse-crisis.js
// ─────────────────────────────────────────────────────────────────
// Pre-fills Q2 (fuel) and Q3 (NEPA) from sessionStorage values
// set by the dashboard. Writes crisis log to Firebase on activation.
// All window.* at TOP LEVEL.
// ─────────────────────────────────────────────────────────────────

import { auth }                      from './firebase-config.js';
import { getDatabase, ref, set, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── Form state
var answers = {
  situation: null,
  fuelLevel: null,
  fuelPct:   0,
  nepa:      null,
  wards:     [],
};
var filled = [false, false, false, false]; // Q1 Q2 Q3 Q4

// ── Generator specs from clinic profile
var tankLitres = 200;
var genKva     = 20;

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
  type = type || 'info';
  var t = document.getElementById('toast');
  var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type;
  m.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 3600);
};

window.selectOption = function(el) {
  var q     = el.dataset.q;
  var val   = el.dataset.val;
  var color = el.dataset.color;

  // Deselect siblings
  document.querySelectorAll('[data-q="' + q + '"]').forEach(function(t) { t.className = 'opt-tile'; });
  el.classList.add('selected-' + color);

  if (q === '1') {
    answers.situation = val;
    filled[0] = true;
    markAnswered(1, val, color);
    updatePreview('pv-situation', val, colorCls(color));
    rowFilled('pr-situation');
  } else if (q === '3') {
    answers.nepa = val;
    filled[2]    = true;
    var isOn = val.includes('Yes');
    markAnswered(3, isOn ? 'Available' : 'Offline', isOn ? 'green' : 'red');
    updatePreview('pv-nepa', isOn ? 'Available' : 'Offline', isOn ? 'green' : 'red');
    rowFilled('pr-nepa');
    // Persist NEPA state so dashboard and triage page see it
    sessionStorage.setItem('pulse_nepa_online', isOn ? 'true' : 'false');
  }
  updatePills();
  updateTriagePreview();
  checkReady();
};

window.setFuel = function(btn) {
  if (!btn) return;
  var level = btn.dataset.level;
  var pct   = parseInt(btn.dataset.pct);

  var MAP = {
    full:     { label:'Full (95%)',     clsSuffix:'full',     ansColor:'green' },
    half:     { label:'Half (55%)',     clsSuffix:'half',     ansColor:'green' },
    quarter:  { label:'Quarter (28%)',  clsSuffix:'quarter',  ansColor:'amber' },
    critical: { label:'Critical (10%)', clsSuffix:'critical', ansColor:'red'   },
  };
  var info = MAP[level] || MAP.half;

  // Reset all fuel buttons
  document.querySelectorAll('.fuel-label-btn').forEach(function(b) { b.className = 'fuel-label-btn'; });
  btn.classList.add('sel-' + level);

  answers.fuelLevel = level;
  answers.fuelPct   = pct;
  filled[1] = true;

  var disp = document.getElementById('fuel-display');
  if (disp) { disp.className = 'fuel-pct-display level-' + info.clsSuffix; disp.textContent = pct + '%'; }
  var lbl = document.getElementById('fuel-label');
  if (lbl) lbl.textContent = info.label;
  var fill = document.getElementById('fuel-fill');
  if (fill) fill.style.width = pct + '%';

  markAnswered(2, info.label, info.ansColor);
  updatePreview('pv-fuel', info.label, info.ansColor);
  rowFilled('pr-fuel');

  // Persist fuel for triage page
  sessionStorage.setItem('pulse_fuel_pct', pct.toString());

  updatePills();
  updateTriagePreview();
  checkReady();
};

window.handleFuelTrackClick = function(e) {
  var rect = e.currentTarget.getBoundingClientRect();
  var pct  = Math.round(((e.clientX - rect.left) / rect.width) * 100);
  var selector = pct >= 75 ? '[data-level="full"]' : pct >= 40 ? '[data-level="half"]' : pct >= 20 ? '[data-level="quarter"]' : '[data-level="critical"]';
  var btn = document.querySelector(selector);
  if (btn) window.setFuel(btn);
};

window.toggleWard = function(el) {
  var ward = el.dataset.ward;
  var idx  = answers.wards.indexOf(ward);
  if (idx > -1) { answers.wards.splice(idx, 1); el.classList.remove('selected'); }
  else          { answers.wards.push(ward);       el.classList.add('selected');    }

  var count = answers.wards.length;
  var lbl   = document.getElementById('ward-count-label');
  if (lbl) lbl.textContent = count === 0 ? 'Select all active wards (tap to toggle)' : count + ' ward' + (count > 1 ? 's' : '') + ' selected';

  filled[3] = count > 0;
  if (count > 0) {
    var names = answers.wards.map(function(w) { return w.split(' ')[0]; }).join(', ');
    markAnswered(4, count + ' ward' + (count > 1 ? 's' : ''), 'blue');
    updatePreview('pv-wards', names, 'filled');
    rowFilled('pr-wards');
    var qv4 = document.getElementById('qv4');
    if (qv4) qv4.textContent = count + ' selected';
  } else {
    document.getElementById('q4')?.classList.remove('answered');
    var qv4 = document.getElementById('qv4');
    if (qv4) qv4.style.opacity = '0';
    updatePreview('pv-wards', 'None selected', '');
    document.getElementById('pr-wards')?.classList.remove('filled');
  }

  updatePills();
  updateTriagePreview();
  checkReady();
};

window.activateProtocol = function() {
  if (!filled.every(Boolean)) return;

  var btn   = document.getElementById('activate-btn');
  var label = document.getElementById('act-label');
  var icon  = document.getElementById('act-icon');
  if (btn)   btn.classList.add('loading');
  if (label) label.textContent = 'Calculating protocol…';
  if (icon)  icon.innerHTML    = '<div class="btn-spin"></div>';

  setTimeout(function() {
    // Save to sessionStorage for triage page
    sessionStorage.setItem('pulse_situation', answers.situation || 'Routine');
    sessionStorage.setItem('pulse_fuel_pct',  answers.fuelPct.toString());
    sessionStorage.setItem('pulse_nepa',      answers.nepa && answers.nepa.includes('Yes') ? 'true' : 'false');
    sessionStorage.setItem('pulse_wards',     JSON.stringify(answers.wards));

    // Save crisis log to Firebase
    var uid = sessionStorage.getItem('pulse_uid');
    if (uid) {
      var key = 'crisis_' + Date.now();
      set(ref(db, 'clinics/' + uid + '/crisisLogs/' + key), {
        situation:  answers.situation,
        fuelPct:    answers.fuelPct,
        nepaOnline: answers.nepa ? answers.nepa.includes('Yes') : false,
        wards:      answers.wards,
        timestamp:  Date.now(),
      }).catch(function() {});
    }

    // Determine severity for overlay styling
    var isCrit = answers.situation === 'Active Surgery' || answers.situation === 'Emergency';
    var isWarn = answers.situation === 'Delivery in Progress' || answers.fuelPct < 25;

    var ring  = document.getElementById('ao-ring');
    var mode  = document.getElementById('ao-mode');
    var title = document.getElementById('ao-title');

    if (isCrit || (isWarn && answers.fuelPct < 20)) {
      if (ring)  { ring.className = 'ao-ring red-ring';   ring.textContent = '!'; }
      if (mode)  { mode.className = 'ao-mode red';        mode.textContent = 'Critical Protocol Active'; }
      if (title) title.textContent = 'PULSE Emergency Triage Activated';
    } else if (isWarn) {
      if (ring)  { ring.className = 'ao-ring amber-ring'; ring.textContent = '!'; }
      if (mode)  { mode.className = 'ao-mode amber';      mode.textContent = 'Warning Protocol Active'; }
      if (title) title.textContent = 'PULSE Triage Protocol Activated';
    } else {
      if (ring)  { ring.className = 'ao-ring green-ring'; ring.textContent = 'P'; }
      if (mode)  { mode.className = 'ao-mode green';      mode.textContent = 'Routine Protocol Active'; }
      if (title) title.textContent = 'PULSE Protocol Activated';
    }

    // Runtime calculation
    var fuelL   = answers.fuelPct * tankLitres / 100;
    var fph     = genKva * 0.25;
    var baseRt  = (fuelL / fph).toFixed(1);
    var optRt   = (fuelL / (fph * (isCrit || isWarn ? 0.4 : 0.75))).toFixed(1);
    var ext     = (parseFloat(optRt) - parseFloat(baseRt)).toFixed(1);

    var num  = document.getElementById('ao-runtime-num');
    var desc = document.getElementById('ao-desc');
    if (num)  num.textContent  = '+' + ext + 'h';
    if (desc) desc.textContent = 'PULSE has computed your clinical energy protocol for ' + answers.situation + ' at ' + answers.fuelPct + '% fuel. ' + answers.wards.length + ' ward' + (answers.wards.length !== 1 ? 's' : '') + ' affected. Tap below to review the triage response.';

    document.getElementById('activation-overlay')?.classList.add('active');
  }, 1800);
};

window.goToTriage = function() {
  window.showToast('Opening Triage Response…', 'success');
  setTimeout(function() { window.location.href = 'pulse-triage.html'; }, 600);
};

window.closeOverlay = function() {
  document.getElementById('activation-overlay')?.classList.remove('active');
  var btn   = document.getElementById('activate-btn');
  var label = document.getElementById('act-label');
  var icon  = document.getElementById('act-icon');
  if (btn)   { btn.classList.remove('loading'); btn.disabled = false; }
  if (label) label.textContent = 'Activate PULSE Protocol';
  if (icon)  icon.innerHTML    = '&#9654;';
};

// ══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════════

function markAnswered(qNum, val, color) {
  var card  = document.getElementById('q' + qNum);
  var valEl = document.getElementById('qv' + qNum);
  if (card)  card.classList.add('answered');
  if (valEl) { valEl.textContent = val; valEl.style.opacity = '1'; valEl.style.transform = 'scale(1)'; }
}

function colorCls(c) { return c === 'green' ? 'green' : c === 'amber' ? 'amber' : c === 'red' ? 'red' : 'filled'; }

function updatePreview(id, val, cls) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.className   = 'prev-val ' + (cls || 'filled');
}

function rowFilled(id) { document.getElementById(id)?.classList.add('filled'); }

function updatePills() {
  filled.forEach(function(f, i) {
    var pill = document.getElementById('pp' + (i+1));
    if (!pill) return;
    var firstUnfilled = filled.indexOf(false);
    pill.className = 'pp ' + (f ? 'done' : (i === firstUnfilled ? 'active' : ''));
  });
  var done = filled.filter(Boolean).length;
  var sub  = document.getElementById('preview-sub');
  if (sub) sub.textContent = done + ' of 4 questions answered';
  if (done > 0) document.getElementById('preview-dot')?.classList.add('active');
}

function updateTriagePreview() {
  var tp = document.getElementById('triage-preview');
  var rp = document.getElementById('runtime-preview');
  var sv = document.getElementById('severity-block');
  if (!answers.situation) {
    tp?.classList.remove('visible');
    rp?.classList.remove('visible');
    if (sv) sv.style.display = 'none';
    return;
  }

  var RULES = {
    'Delivery in Progress': { on:['Delivery room lights','Oxygen concentrator','Fetal monitor','Vaccine fridge'],    reduce:['Corridor lighting','Maternity fans'],      off:['Staff room AC','Admin computers','Phone chargers']  },
    'Active Surgery':       { on:['Theatre lights','Anaesthesia machine','Suction pump','Steriliser'],               reduce:['Ward lighting','Reception lights'],         off:['Staff room AC','Non-essential computers','TV']      },
    'Emergency':            { on:['All life-critical devices','Emergency lighting','Oxygen supply','Defibrillator'], reduce:['General ward lighting'],                   off:['Admin equipment','Staff room AC']                   },
    'Routine':              { on:['Vaccine fridge','Essential lighting','Reception equipment'],                      reduce:['Non-critical lighting'],                   off:['Staff room AC (if fuel < 50%)']                     },
  };
  var rules = RULES[answers.situation] || RULES['Routine'];
  var items = document.getElementById('tp-items');
  if (items) {
    items.innerHTML = '';
    rules.on.slice(0,3).forEach(function(i)    { items.innerHTML += '<div class="tp-item"><div class="tp-dot on"></div><span class="tp-text-on">Keep: '+i+'</span></div>'; });
    rules.reduce.slice(0,2).forEach(function(i){ items.innerHTML += '<div class="tp-item"><div class="tp-dot reduce"></div><span class="tp-text-reduce">Reduce: '+i+'</span></div>'; });
    rules.off.slice(0,2).forEach(function(i)   { items.innerHTML += '<div class="tp-item"><div class="tp-dot off"></div><span class="tp-text-off">Cut: '+i+'</span></div>'; });
  }
  tp?.classList.add('visible');

  if (answers.fuelPct > 0) {
    var fuelL   = answers.fuelPct * tankLitres / 100;
    var fph     = genKva * 0.25;
    var base    = (fuelL / fph).toFixed(1);
    var isCrit  = answers.situation === 'Active Surgery' || answers.situation === 'Emergency';
    var isWarn  = answers.situation === 'Delivery in Progress';
    var optMult = isCrit || isWarn ? 0.4 : 0.75;
    var opt     = (fuelL / (fph * optMult)).toFixed(1);
    var ext     = (parseFloat(opt) - parseFloat(base)).toFixed(1);
    var rpNum = document.getElementById('rp-num');
    var rpSub = document.getElementById('rp-sub');
    if (rpNum) rpNum.textContent = opt + 'h';
    if (rpSub) rpSub.textContent = 'Optimised: ' + opt + 'h (base: ' + base + 'h, +' + ext + 'h saved by PULSE)';
    rp?.classList.add('visible');

    // Severity bar
    var sev   = answers.situation === 'Emergency' ? 95 : answers.situation === 'Active Surgery' ? 80 : answers.situation === 'Delivery in Progress' ? 65 : 30;
    var fuelMod = answers.fuelPct < 20 ? 20 : answers.fuelPct < 40 ? 10 : 0;
    var finalSev = Math.min(100, sev + fuelMod);
    var sevColor = finalSev > 70 ? 'var(--red)' : finalSev > 45 ? 'var(--amber)' : 'var(--g1)';
    var sevBar = document.getElementById('severity-bar');
    if (sevBar) { sevBar.style.width = finalSev + '%'; sevBar.style.background = sevColor; }
    if (sv) sv.style.display = 'block';
  }
}

function checkReady() {
  var allDone = filled.every(Boolean);
  var btn     = document.getElementById('activate-btn');
  if (!btn) return;
  btn.disabled = !allDone;
  var hint = document.getElementById('activate-hint');
  if (hint) hint.innerHTML = allDone
    ? 'All questions answered &mdash; <span>ready to activate</span>'
    : 'Answer all 4 questions to <span>activate the triage protocol</span>';
}

function startClock() {
  function tick() {
    var n = new Date();
    var ts = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
    var cl = document.getElementById('live-clock');
    var st = document.getElementById('strip-time');
    if (cl) cl.textContent = ts;
    if (st) st.textContent = ts;
  }
  tick(); setInterval(tick, 10000);
}

function prefillFromSession() {
  // Pre-fill Q3 (NEPA) from sessionStorage
  var storedNepa = sessionStorage.getItem('pulse_nepa_online');
  if (storedNepa !== null) {
    var isOn  = storedNepa === 'true';
    var opts  = document.querySelectorAll('#q3-opts .opt-tile');
    opts.forEach(function(t) { t.className = 'opt-tile'; });
    if (isOn) { opts[0]?.classList.add('selected-green'); answers.nepa = 'Yes — NEPA Available'; }
    else      { opts[1]?.classList.add('selected-red');   answers.nepa = 'No — NEPA Offline';    }
    filled[2] = true;
    markAnswered(3, isOn ? 'Available' : 'Offline', isOn ? 'green' : 'red');
    updatePreview('pv-nepa', isOn ? 'Available' : 'Offline', isOn ? 'green' : 'red');
    rowFilled('pr-nepa');
  }

  // Pre-fill Q2 (fuel) from sessionStorage
  var storedFuel = sessionStorage.getItem('pulse_fuel_pct');
  if (storedFuel) {
    var pct = parseInt(storedFuel);
    var sel = pct >= 75 ? '[data-level="full"]' : pct >= 40 ? '[data-level="half"]' : pct >= 20 ? '[data-level="quarter"]' : '[data-level="critical"]';
    var btn = document.querySelector(sel);
    if (btn) window.setFuel(btn);
  }

  updatePills();
  checkReady();
}

function loadClinicSpecs() {
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try {
      var d = JSON.parse(cached);
      if (d.tankLitres)   tankLitres = parseFloat(d.tankLitres);
      if (d.generatorKva) genKva     = parseFloat(d.generatorKva);
      // Update the crisis strip with real clinic data
      var strip = document.querySelector('.cs-text');
      if (strip && d.liveReadings) {
        var nepaOn = d.liveReadings.nepaOnline;
        var fuel   = Math.round(d.liveReadings.fuelPct || 38);
        strip.textContent = 'NEPA ' + (nepaOn ? 'online' : 'offline') + ' — Generator at ' + fuel + '% fuel capacity';
      }
    } catch(e) {}
  }
}

// ── Auth guard
onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);

  // Fetch fresh clinic data if not cached
  if (!sessionStorage.getItem('pulse_clinic')) {
    get(ref(db, 'clinics/' + user.uid)).then(function(snap) {
      if (snap.exists()) {
        sessionStorage.setItem('pulse_clinic', JSON.stringify(snap.val()));
        loadClinicSpecs();
      }
    }).catch(function() {});
  }
});

document.addEventListener('DOMContentLoaded', function() {
  startClock();
  loadClinicSpecs();
  prefillFromSession();
  // Activate first pill
  document.getElementById('pp1')?.classList.add('active');
});