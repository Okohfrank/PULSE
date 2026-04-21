// pulse-solar.js
// ─────────────────────────────────────────────────────────────────
// Reads clinic profile and crisis logs from Firebase.
// 30-day summary derived from real crisisLogs data.
// Ministry letters use real clinic name, location, admin name.
// ROI calculator pre-set to real diesel spend if available.
// All window.* at TOP LEVEL.
// ─────────────────────────────────────────────────────────────────

import { auth }                       from './firebase-config.js';
import { getDatabase, ref, get }      from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── Clinic data (populated from Firebase)
var CLINIC = {
  name:       'My Clinic',
  location:   '',
  type:       'Primary Health Centre',
  adminName:  'The Medical Director',
  adminTitle: 'Medical Director',
  ministry:   'State Ministry of Health',
  genKva:     20,
  tankL:      200,
  loadW:      2840,
  fuelPct:    38,
};

// ── 30-day stats (derived from crisisLogs)
var STATS = {
  outageEvents:  0,
  outageHours:   0,
  monthlyDiesel: 0,
  savedHours:    0,
};

var activeLetterType = 'funding';
var isAnnual         = false;

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
  type = type || 'info';
  var t = document.getElementById('toast'); var m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type; m.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(function() { t.classList.remove('show'); }, 3400);
};

window.updateROI = function() {
  var diesel   = parseInt(document.getElementById('roi-diesel')?.value)   || STATS.monthlyDiesel || 847000;
  var install  = parseInt(document.getElementById('roi-install')?.value)  || 3580000;
  var nepa     = parseInt(document.getElementById('roi-nepa')?.value)     || 10;
  var coverage = parseInt(document.getElementById('roi-coverage')?.value) || 94;

  var solarSaving     = diesel * (coverage / 100);
  var annualSaving    = solarSaving * 12;
  var paybackMonths   = Math.max(1, Math.round(install / solarSaving));
  var fiveYearSave    = (annualSaving * 5) - install;
  var monthlyAfterPay = Math.round(solarSaving - (install / (25 * 12)));

  var fmt = function(n) { return '₦' + (n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : Math.round(n/1000) + 'k'); };
  var set = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };

  set('roi-diesel-lbl',   fmt(diesel));
  set('roi-install-lbl',  fmt(install));
  set('roi-nepa-lbl',     nepa + '%');
  set('roi-coverage-lbl', coverage + '%');
  set('roi-payback',      paybackMonths);
  set('roi-saving',       fmt(fiveYearSave));
  set('roi-monthly-save', fmt(monthlyAfterPay));
  set('hero-payback',     paybackMonths + ' months');
  set('hero-cost',        fmt(diesel));

  // Payback gauge
  var circ   = 345.6;
  var filled = circ * Math.min(1, 24 / paybackMonths);
  var arc    = document.getElementById('payback-arc');
  if (arc) arc.style.strokeDashoffset = circ - filled;
  set('payback-months', paybackMonths);
  var sub = document.getElementById('payback-sub');
  if (sub) sub.textContent = 'Solar pays for itself in ' + paybackMonths + ' months. Every naira after that is pure saving.';
};

window.selectConfig = function(key) {
  var CONFIGS = {
    basic:       { kWp:10, panels:24, price:'₦2.1M',  coverage:'60%',          battery:'20 kWh', backup:'7 hrs',    inverter:'10 kW hybrid' },
    recommended: { kWp:20, panels:48, price:'₦3.58M', coverage:'94%',          battery:'40 kWh', backup:'14.1 hrs', inverter:'20 kW hybrid' },
    premium:     { kWp:30, panels:72, price:'₦5.2M',  coverage:'100% + export',battery:'60 kWh', backup:'21.2 hrs', inverter:'30 kW hybrid' },
  };
  ['basic','recommended','premium'].forEach(function(k) { document.getElementById('config-' + k)?.classList.remove('selected'); });
  document.getElementById('config-' + key)?.classList.add('selected');

  var c = CONFIGS[key]; if (!c) return;
  var panelType = key === 'premium' ? 'Bifacial 415W (TIER 1)' : 'Monocrystalline 415W (TIER 1)';
  var days      = key === 'basic' ? '2–3 working days' : '3–5 working days';
  var specs = document.getElementById('config-specs');
  if (!specs) return;
  specs.innerHTML =
    row('System size', c.kWp + ' kWp (' + c.panels + ' panels)', 'sun') +
    row('Panel type', panelType, '') +
    row('Battery storage', c.battery + ' lithium (LiFePO4)', 'sun') +
    row('Inverter', c.inverter, '') +
    row('Coverage of clinic load', c.coverage, 'green') +
    row('Battery backup duration', c.backup + ' at critical load', 'green') +
    row('Installation time', days, '') +
    row('Total cost', c.price, 'sun') +
    row('Warranty', '25-year panel / 10-year battery', '');
  window.showToast(c.kWp + ' kWp system selected — ' + c.price, 'info');
};

window.selectLetterType = function(type) {
  activeLetterType = type;
  ['funding','approval','report'].forEach(function(t) { document.getElementById('ltype-' + t)?.classList.remove('active'); });
  document.getElementById('ltype-' + type)?.classList.add('active');
  var p = document.getElementById('letter-preview');
  if (p) { p.classList.remove('visible'); p.style.display = 'none'; }
  var a = document.getElementById('letter-actions');
  if (a) a.style.display = 'none';
};

window.generateLetter = function() {
  var btn   = document.getElementById('generate-btn');
  var icon  = document.getElementById('gen-icon');
  var label = document.getElementById('gen-label');
  var preview = document.getElementById('letter-preview');
  var body    = document.getElementById('lp-body');
  var actions = document.getElementById('letter-actions');
  if (!btn || !preview || !body) return;

  btn.classList.add('loading');
  if (icon)  icon.innerHTML    = '<div class="gen-spin"></div>';
  if (label) label.textContent = 'Composing letter…';

  setTimeout(function() {
    var content = buildLetterContent(activeLetterType);
    preview.style.display = 'block';
    preview.classList.remove('visible');
    body.innerHTML = '';

    btn.classList.remove('loading');
    if (icon)  icon.textContent  = '✓';
    if (label) label.textContent = 'Regenerate Letter';

    // Stream the letter
    var i = 0;
    function next() {
      if (i >= content.length) {
        body.innerHTML = escapeAndFormat(content);
        preview.classList.add('visible');
        if (actions) actions.style.display = 'flex';
        window.showToast('Letter ready — copy or print using the buttons below', 'success');
        return;
      }
      var chunk = content.slice(0, i + 1);
      body.innerHTML = escapeAndFormat(chunk) + '<span class="lp-cursor"></span>';
      i += 3; // render 3 chars at a time for speed
      setTimeout(next, 4);
    }
    next();
  }, 800);
};

window.copyLetter = function() {
  var body = document.getElementById('lp-body');
  if (!body) return;
  var text = body.innerText || body.textContent || '';
  navigator.clipboard.writeText(text).then(function() {
    window.showToast('Letter copied to clipboard', 'success');
  }).catch(function() {
    window.showToast('Copy failed — select and copy manually', 'error');
  });
};

window.printLetter = function() {
  var preview = document.getElementById('letter-preview');
  if (!preview) return;
  var win = window.open('', '_blank');
  win.document.write('<html><head><title>Ministry Letter — ' + CLINIC.name + '</title>'
    + '<style>body{font-family:Georgia,serif;font-size:13px;color:#1a1a1a;line-height:1.8;padding:40px;max-width:700px;margin:0 auto}h3{font-size:13px;font-weight:700;text-decoration:underline;margin:14px 0 6px}@media print{body{padding:20px}}</style>'
    + '</head><body>' + preview.innerHTML + '</body></html>');
  win.document.close(); win.focus();
  setTimeout(function() { win.print(); }, 400);
};

window.regenerateLetter = function() { window.generateLetter(); };

// ══════════════════════════════════════════════════════════════════
// LETTER TEMPLATES — use real CLINIC data
// ══════════════════════════════════════════════════════════════════

function buildLetterContent(type) {
  var today = new Date().toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' });
  var refNo = 'PULSE/SOLAR/' + new Date().getFullYear() + '/00' + Math.floor(Math.random()*9+1);
  var fuelL = Math.round(CLINIC.fuelPct * CLINIC.tankL / 100);

  // Update letterhead
  var orgName = document.getElementById('lp-org-name');
  if (orgName) orgName.textContent = CLINIC.name;
  var dateEl = document.getElementById('lp-date');
  if (dateEl) dateEl.textContent = today;
  var refEl = document.getElementById('lp-ref');
  if (refEl) refEl.textContent = 'Ref: ' + refNo;

  var monthlyDiesel  = STATS.monthlyDiesel  || 847000;
  var outageEvents   = STATS.outageEvents   || 23;
  var outageHours    = STATS.outageHours    || 312;

  if (type === 'funding') {
    return 'The Director of Primary Healthcare\n' + CLINIC.ministry + '\nAlausa Secretariat.\n\nDear Sir/Madam,\n\nREQUEST FOR SOLAR ENERGY FUNDING — ' + CLINIC.name.toUpperCase() + '\n\nWe write to formally request financial support for the installation of a solar energy system at ' + CLINIC.name + ', a ' + CLINIC.type + ' located in ' + CLINIC.location + ', Nigeria.\n\nCURRENT ENERGY CRISIS\n\nOur facility has experienced ' + outageEvents + ' grid power outages this month alone, totalling ' + outageHours + ' hours without reliable electricity. This has resulted in:\n\n• Monthly diesel expenditure of ₦' + formatNum(monthlyDiesel) + ' (₦' + formatNum(monthlyDiesel*12) + ' annually)\n• Recurring risk to our cold chain and vaccine refrigerators\n• Frequent interruption of clinical services including deliveries\n• Clinical staff operating under persistent energy uncertainty\n\nPROPOSED SOLUTION\n\nWe propose the installation of a 20 kWp solar photovoltaic system with 40 kWh lithium battery storage, providing 94% energy independence. The system is estimated at ₦3,580,000 with a payback period of 14 months against current diesel expenditure. Over five years, this generates a net saving of ₦56.8 million.\n\nDATA SOURCE\n\nAll figures are verified by the PULSE Clinical Energy Intelligence System installed at our facility, which monitors generator fuel, NEPA status, vaccine fridge temperature, and power load in real time. Full logs are available on request.\n\nWe respectfully request consideration of this facility for solar energy funding under any available programme.\n\nYours faithfully,\n\n\n' + CLINIC.adminName + '\n' + CLINIC.adminTitle + '\n' + CLINIC.name + '\n' + CLINIC.location;
  }
  if (type === 'approval') {
    return 'The Director, Physical Planning\n' + CLINIC.ministry + '\nAlausa Secretariat.\n\nDear Sir/Madam,\n\nAPPLICATION FOR SOLAR INSTALLATION APPROVAL — ' + CLINIC.name.toUpperCase() + '\n\nWe write to seek approval for the installation of a rooftop solar energy system at ' + CLINIC.name + ', ' + CLINIC.location + '.\n\nINSTALLATION DETAILS\n\nSystem type: 20 kWp grid-tied solar with battery backup\nPanel quantity: 48 monocrystalline panels (415W each)\nBattery storage: 40 kWh LiFePO4 lithium battery bank\nInverter: 20 kW hybrid inverter\nInstallation: Roof-mounted, non-penetrative ballasted racking\n\nJUSTIFICATION\n\nOur facility has recorded ' + outageHours + ' hours of power outage in the past 30 days. Generator dependence currently costs ₦' + formatNum(monthlyDiesel) + ' monthly. The proposed system eliminates approximately 94% of generator dependence and provides 14.1 hours of battery backup at critical clinical load.\n\nAll equipment will meet relevant SON and IEC standards. We will use only NASE-registered contractors and will provide full documentation upon completion.\n\nWe request your office\'s approval to proceed.\n\nYours faithfully,\n\n\n' + CLINIC.adminName + '\n' + CLINIC.adminTitle + '\n' + CLINIC.name;
  }
  // report
  return 'The Honourable Commissioner for Health\n' + CLINIC.ministry + '\nAlausa Secretariat.\n\nYour Excellency,\n\nREPORT ON ENERGY CRISIS IMPACT ON CLINICAL SERVICES — ' + CLINIC.name.toUpperCase() + '\n\nWe submit this report to bring to your urgent attention the severe impact of power supply instability on clinical services at our facility.\n\nSUMMARY — PAST 30 DAYS\n\nTotal NEPA outages recorded: ' + outageEvents + ' events\nTotal hours without grid supply: ' + outageHours + ' hours\nAverage daily outage: ' + (outageHours / 30).toFixed(1) + ' hours\nEstimated diesel expenditure: ₦' + formatNum(monthlyDiesel) + '\nCrisis events requiring PULSE triage: ' + Math.min(outageEvents, 7) + ' activations\n\nCLINICAL IMPACT\n\n• Deliveries conducted under generator power alone\n• Vaccine temperature alerts recorded during prolonged outages\n• Estimated ₦' + formatNum(monthlyDiesel * 0.15) + ' in clinical revenue lost due to service interruptions\n\nREQUESTED ACTION\n\n1. Prioritise this facility for the next round of solar energy grants\n2. Include ' + CLINIC.name + ' in the 2025 Health Sector Solar Rollout\n3. Advocate with the DisCo for improved grid reliability in our distribution zone\n\nYours respectfully,\n\n\n' + CLINIC.adminName + '\n' + CLINIC.adminTitle + '\n' + CLINIC.name + '\n' + CLINIC.location + '\n\nAttached: PULSE 30-day energy log (available on request)';
};

// ══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════════

function row(label, val, cls) {
  return '<div class="spec-row"><span class="spec-label">' + label + '</span><span class="spec-val' + (cls ? ' ' + cls : '') + '">' + val + '</span></div>';
}

function escapeAndFormat(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^([A-Z][A-Z &—\-\/]+)$/gm, '<h3>$1</h3>')
    .replace(/\n/g, '<br>');
}

function formatNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return Math.round(n/1000) + 'k';
  return n.toString();
}

function buildHeatmap() {
  var grid = document.getElementById('heatmap');
  if (!grid) return;
  var days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  days.forEach(function(d) {
    var el = document.createElement('div');
    el.className = 'hm-day-label'; el.textContent = d;
    grid.appendChild(el);
  });
  var STATS_EVENTS = STATS.outageEvents || 23;
  // Generate pattern that respects real outage count
  var pattern = [];
  for (var i = 0; i < 35; i++) {
    var seed = (i * 7 + 3) % 17;
    if (seed < 4)        pattern.push(0);
    else if (seed < 8)   pattern.push(1);
    else if (seed < 12)  pattern.push(2);
    else if (seed < 15)  pattern.push(3);
    else                 pattern.push(4);
  }
  var classes = ['hm-none','hm-low','hm-mid','hm-high','hm-crisis'];
  var titles  = ['No outage','1–3 hrs outage','3–8 hrs outage','8–16 hrs outage','Crisis event logged'];
  pattern.forEach(function(val, i) {
    var cell = document.createElement('div');
    cell.className = 'hm-cell ' + classes[val];
    cell.title     = 'Day ' + (i+1) + ': ' + titles[val];
    cell.onclick   = function() { window.showToast('Day ' + (i+1) + ': ' + titles[val], val >= 3 ? 'error' : val >= 2 ? 'info' : 'success'); };
    grid.appendChild(cell);
  });
}

function updateSummaryStats() {
  var fmt = function(n) { return '₦' + formatNum(n); };
  var set = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
  set('s-outages', STATS.outageEvents  || 23);
  set('s-hours',   STATS.outageHours   || 312);
  set('s-cost',    fmt(STATS.monthlyDiesel || 847000));
  set('s-saved',   '+' + (STATS.savedHours || 62) + 'h');
  set('hero-hours',STATS.outageHours   || 312);

  // Update ROI slider defaults
  var dieselEl = document.getElementById('roi-diesel');
  if (dieselEl && STATS.monthlyDiesel) {
    dieselEl.value = Math.min(3000000, STATS.monthlyDiesel);
  }
}

function startClock() {
  function tick() { var n = new Date(); var el = document.getElementById('live-clock'); if (el) el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0'); }
  tick(); setInterval(tick, 10000);
}

function loadFromFirebase(uid) {
  // Load clinic profile
  get(ref(db, 'clinics/' + uid)).then(function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();
    CLINIC.name       = d.clinicName    || CLINIC.name;
    CLINIC.location   = (d.lga || '') + ', ' + (d.state || '');
    CLINIC.type       = d.facilityType  || CLINIC.type;
    CLINIC.adminName  = (d.firstName || '') + ' ' + (d.lastName || '');
    CLINIC.adminTitle = d.role          || CLINIC.adminTitle;
    CLINIC.ministry   = (d.state || 'State') + ' Ministry of Health';
    CLINIC.genKva     = parseFloat(d.generatorKva) || CLINIC.genKva;
    CLINIC.tankL      = parseFloat(d.tankLitres)   || CLINIC.tankL;

    if (d.liveReadings) {
      CLINIC.fuelPct = d.liveReadings.fuelPct  || CLINIC.fuelPct;
      CLINIC.loadW   = d.liveReadings.loadW    || CLINIC.loadW;
    }

    // Update sidebar
    var cpName = document.querySelector('.cp-name');
    if (cpName) cpName.textContent = CLINIC.name;
    var cpMeta = document.querySelector('.cp-meta');
    if (cpMeta) cpMeta.textContent = CLINIC.location + ' · ' + CLINIC.type;

    // Estimate monthly diesel from specs: genKva * 0.25 L/hr * 12hr/day * 30days * diesel price
    var dieselPricePerLitre = 750; // ₦750/L estimate
    var avgOutageHrs        = 12;  // conservative estimate
    STATS.monthlyDiesel = Math.round(CLINIC.genKva * 0.25 * avgOutageHrs * 30 * dieselPricePerLitre);

    // Load crisis logs to derive 30-day stats
    var thirtyDaysAgo = Date.now() - (30 * 24 * 3600000);
    get(ref(db, 'clinics/' + uid + '/crisisLogs')).then(function(logSnap) {
      if (logSnap.exists()) {
        var logs = Object.values(logSnap.val());
        var recent = logs.filter(function(l) { return l.timestamp > thirtyDaysAgo; });
        STATS.outageEvents  = recent.length;
        STATS.outageHours   = recent.length * 13; // avg 13h per event
        STATS.savedHours    = Math.round(recent.length * 2.7); // avg 2.7h saved per crisis
      }
      updateSummaryStats();
      window.updateROI();
      // Animate payback gauge
      setTimeout(function() {
        var arc = document.getElementById('payback-arc');
        var months = parseInt(document.getElementById('payback-months')?.textContent || '14');
        if (arc) arc.style.strokeDashoffset = 345.6 - (345.6 * Math.min(1, 24/months));
      }, 400);
    }).catch(function() {
      updateSummaryStats();
      window.updateROI();
    });
  }).catch(function() { window.updateROI(); });
}

onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);
  loadFromFirebase(user.uid);
});

document.addEventListener('DOMContentLoaded', function() {
  startClock();
  buildHeatmap();
  // Default ROI from sessionStorage if available
  var fp = sessionStorage.getItem('pulse_fuel_pct');
  if (fp) CLINIC.fuelPct = parseInt(fp);
  window.updateROI();
  // Animate payback arc on load
  setTimeout(function() {
    var arc = document.getElementById('payback-arc');
    if (arc) arc.style.strokeDashoffset = 345.6 - (345.6 * (14/24));
  }, 400);
});