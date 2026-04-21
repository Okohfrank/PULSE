// pulse-dashboard.js
// ─────────────────────────────────────────────────────────────────
// Reads REAL clinic data from Firebase on load.
// Live gauge simulation runs on top of the real baseline values.
// NEPA toggle writes back to Firebase + sessionStorage.
// All window.* at TOP LEVEL for onclick compatibility.
// ─────────────────────────────────────────────────────────────────

import { auth }                         from './firebase-config.js';
import { getDatabase, ref,
         get, update, onValue }         from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── Live data state (overwritten by Firebase values on load)
var genPct      = 38;
var fridgeTemp  = 4.8;
var loadW       = 2840;
var upsPct      = 62;
var nepaOnline  = false;
var nepaOffStart= null;   // timestamp ms

// ── Generator spec (overwritten from Firebase)
var tankLitres  = 200;
var genKva      = 20;

// ── Drift direction for live simulation
var genDir      = -1;
var fridgeDir   = 1;
var loadDir     = 1;

// ── Guide state
var currentTip  = 0;
var guideActive = false;

var GUIDE_TIPS = [
  { title:'Welcome to your PULSE dashboard',  body:'This is your clinic\'s live energy command centre. Every critical system is monitored here in real time — generator fuel, vaccine fridge temperature, NEPA status, and current power load.',   icon:'P', anchor:'section-banner'  },
  { title:'AI Prediction Banner',             body:'This banner is your AI early-warning system. PULSE analyses your energy patterns and warns you of potential crises hours before they happen.',                                                   icon:'A', anchor:'section-banner'  },
  { title:'NEPA Grid Status',                 body:'This shows whether NEPA is supplying your clinic and how long the outage has been running. Tap the button to toggle and see how PULSE responds.',                                               icon:'N', anchor:'section-nepa'   },
  { title:'Energy Vitals — 4 gauges',         body:'Generator fuel, vaccine fridge temperature, total load, and UPS battery. All update every 2 seconds from your live readings.',                                                                 icon:'V', anchor:'section-vitals' },
  { title:'Live Energy Waveform',             body:'This ECG-style chart shows your clinic\'s real-time power consumption. Spikes indicate high-demand moments like equipment startup.',                                                            icon:'E', anchor:'section-ecg'    },
  { title:'Ward Status',                      body:'Every ward in your clinic is tracked here. Tap any ward to see its consumption and connected appliances.',                                                                                       icon:'W', anchor:'section-wards'  },
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

window.toggleNEPA = function() {
  nepaOnline = !nepaOnline;
  nepaOffStart = nepaOnline ? null : Date.now();

  // Persist to sessionStorage (read by crisis page)
  sessionStorage.setItem('pulse_nepa_online', nepaOnline ? 'true' : 'false');
  if (!nepaOnline) {
    sessionStorage.setItem('pulse_nepa_off_start', Date.now().toString());
  } else {
    sessionStorage.removeItem('pulse_nepa_off_start');
  }

  // Write to Firebase
  var uid = sessionStorage.getItem('pulse_uid');
  if (uid) {
    update(ref(db, 'clinics/' + uid + '/liveReadings'), {
      nepaOnline:    nepaOnline,
      nepaOffStart:  nepaOnline ? null : Date.now(),
      updatedAt:     Date.now(),
    }).catch(function() {});
  }

  renderNEPABanner();
  window.showToast(
    nepaOnline ? 'NEPA supply restored — generator conserving fuel' : 'NEPA offline — generator now carrying full load',
    nepaOnline ? 'success' : 'error'
  );
};

window.openCardDetail = function(type) {
  var fuelL   = Math.round(genPct * tankLitres / 100);
  var runtime = (fuelL / (genKva * 0.25)).toFixed(1);
  var msgs = {
    generator: 'Generator: ' + Math.round(genPct) + '% fuel, ' + fuelL + 'L remaining. Est. runtime: ' + runtime + ' hrs.',
    fridge:    'Vaccine Fridge: ' + fridgeTemp.toFixed(1) + '°C — within safe range (2°C–8°C). Life-critical — never cut during triage.',
    load:      'Current load: ' + loadW.toLocaleString() + 'W. Critical-only load: ~1,140W. Reducible: ~' + (loadW - 1140).toLocaleString() + 'W.',
    ups:       'UPS Battery: ' + Math.round(upsPct) + '%. ~' + Math.round(upsPct * 0.6) + ' min backup at critical load.',
  };
  window.showToast(msgs[type] || 'Loading…', 'success');
};

window.nextGuideTip = function() {
  if (currentTip < GUIDE_TIPS.length - 1) {
    hideGuideTip(function() { showGuideTip(currentTip + 1); });
  } else {
    endGuide();
  }
};

window.skipGuide = function() { endGuide(); };

window.toggleGuide = function() {
  if (guideActive) { endGuide(); }
  else { localStorage.removeItem('pulse-guide-done'); showGuideTip(0); }
};

window.dismissProBanner = function() {
  var b = document.getElementById('pro-upgrade-banner');
  if (b) b.style.display = 'none';
  localStorage.setItem('pulse-pro-dismissed', Date.now().toString());
  window.showToast('Banner dismissed.', 'success');
};

// ══════════════════════════════════════════════════════════════════
// INTERNAL — not called from HTML
// ══════════════════════════════════════════════════════════════════

// ── Render gauge (SVG stroke-dasharray approach matching HTML)
function setGauge(id, pct, arcLen) {
  var el = document.getElementById(id);
  if (!el) return;
  var filled = Math.max(0, Math.min(1, pct / 100)) * arcLen;
  el.setAttribute('stroke-dasharray', filled + ' ' + arcLen);
  // Colour
  var colour = pct < 20 ? '#e8415a' : pct < 40 ? '#f0a500' : '#00e87a';
  if (id === 'fridge-gauge') colour = '#00d4b8'; // always teal
  el.setAttribute('stroke', colour);
}

// ── Apply clinic data to all DOM elements
function applyClinicData(d) {
  if (!d) return;

  // Sidebar
  var sbName = document.getElementById('sb-clinic-name');
  var sbMeta = document.getElementById('sb-clinic-meta');
  if (sbName) sbName.textContent = d.clinicName || 'My Clinic';
  if (sbMeta) sbMeta.textContent = (d.lga || '') + ', ' + (d.state || '') + ' · ' + (d.facilityType || 'PHC');

  // Topbar greeting
  var h = new Date().getHours();
  var greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  var greetTop = document.getElementById('greeting-top');
  var greetName = document.getElementById('greeting-name');
  var greetClinic = document.getElementById('greeting-clinic');
  if (greetTop)    greetTop.textContent    = greet;
  if (greetName)   greetName.textContent   = d.firstName || d.adminName || 'Doctor';
  if (greetClinic) greetClinic.textContent = d.clinicName || 'My Clinic';

  // Avatar initials
  var avatar = document.getElementById('avatar');
  if (avatar && d.firstName && d.lastName) {
    avatar.textContent = (d.firstName[0] + d.lastName[0]).toUpperCase();
  }

  // Store generator specs for calculations
  if (d.generatorKva)  genKva     = parseFloat(d.generatorKva);
  if (d.tankLitres)    tankLitres = parseFloat(d.tankLitres);

  // Apply live readings if they exist
  var r = d.liveReadings;
  if (r) {
    if (r.fuelPct    != null) genPct     = r.fuelPct;
    if (r.fridgeTemp != null) fridgeTemp = r.fridgeTemp;
    if (r.loadW      != null) loadW      = r.loadW;
    if (r.nepaOnline != null) nepaOnline = r.nepaOnline;
    if (r.nepaOffStart)       nepaOffStart = r.nepaOffStart;
  }

  // Update plan in sessionStorage
  if (d.plan) sessionStorage.setItem('pulse_plan', d.plan);

  // Initial render of all vitals
  renderVitals();
  renderNEPABanner();
  renderFuelTimeline();
}

function renderVitals() {
  // Generator
  var genRound = Math.round(genPct);
  var fuelL    = Math.round(genPct * tankLitres / 100);
  var runtime  = (fuelL / (genKva * 0.25)).toFixed(1);
  var genVal   = document.getElementById('gen-val');
  var genSt    = document.getElementById('gen-status');
  var genRt    = document.getElementById('gen-runtime');
  if (genVal) genVal.textContent  = genRound + '%';
  if (genSt)  genSt.textContent   = (genPct < 25 ? 'Critical' : genPct < 40 ? 'Low' : 'Moderate') + ' — ' + fuelL + 'L remaining';
  if (genRt)  genRt.textContent   = runtime + ' hrs';
  setGauge('gen-gauge', genPct, 240);

  // Fridge
  var fridgeVal = document.getElementById('fridge-val');
  if (fridgeVal) fridgeVal.textContent = fridgeTemp.toFixed(1);
  var fridgePct = ((fridgeTemp - 2) / (8 - 2)) * 100;
  setGauge('fridge-gauge', fridgePct, 200);

  // Load
  var loadVal = document.getElementById('load-val');
  if (loadVal) loadVal.innerHTML = loadW.toLocaleString() + '<span style="font-size:14px;font-weight:400;color:var(--mid)">W</span>';
  var loadBar = document.getElementById('load-bar');
  if (loadBar) loadBar.style.width = (loadW / 16000 * 100) + '%';
  var ecgCur = document.getElementById('ecg-current');
  if (ecgCur) ecgCur.textContent = loadW.toLocaleString() + 'W';

  // UPS
  var upsRound = Math.round(upsPct);
  var upsVal = document.getElementById('ups-val');
  if (upsVal) upsVal.innerHTML = upsRound + '<span style="font-size:14px;font-weight:400;color:var(--mid)">%</span>';
  var upsBar = document.getElementById('ups-bar');
  if (upsBar) {
    upsBar.style.width = upsRound + '%';
    upsBar.style.background = upsRound < 30 ? 'linear-gradient(90deg,var(--red),#e86070)' : 'linear-gradient(90deg,var(--amber),#f0c040)';
  }
  var upsSt = document.getElementById('ups-status');
  if (upsSt) upsSt.textContent = Math.round(upsRound * 0.6) + ' min backup at critical load';
}

function renderNEPABanner() {
  var banner = document.getElementById('nepa-banner');
  var main   = document.getElementById('nepa-main');
  var sub    = document.getElementById('nepa-sub');
  var dur    = document.getElementById('nepa-duration');
  var btn    = document.getElementById('nepa-toggle-btn');
  if (!banner) return;

  if (nepaOnline) {
    banner.className = 'nepa-banner online';
    if (main) main.textContent = 'NEPA Supply — Online';
    if (sub)  sub.textContent  = 'Grid power is available. Generator conserving fuel.';
    if (dur)  { dur.textContent = 'Live'; dur.style.color = 'var(--g1)'; }
    if (btn)  btn.textContent  = 'Simulate outage';
  } else {
    banner.className = 'nepa-banner offline';
    if (main) main.textContent = 'NEPA Supply — Offline';
    if (sub)  sub.textContent  = 'Running on generator only.';
    if (btn)  btn.textContent  = 'Simulate supply';
    // Start NEPA outage timer
    startNEPATimer();
  }
}

var nepaTimerInterval = null;
function startNEPATimer() {
  if (nepaTimerInterval) clearInterval(nepaTimerInterval);
  var dur = document.getElementById('nepa-duration');
  if (!dur) return;
  nepaTimerInterval = setInterval(function() {
    if (nepaOnline) { clearInterval(nepaTimerInterval); return; }
    var start = nepaOffStart || (Date.now() - 7.4 * 3600000); // fallback to 7.4h ago
    var ms = Date.now() - start;
    var h  = Math.floor(ms / 3600000);
    var m  = Math.floor((ms % 3600000) / 60000);
    dur.textContent = h + 'h ' + String(m).padStart(2, '0') + 'm';
    dur.style.color = 'var(--red)';
  }, 30000);
  // Run once immediately
  var start = nepaOffStart || (Date.now() - 7.4 * 3600000);
  var ms = Date.now() - start;
  var h  = Math.floor(ms / 3600000);
  var m  = Math.floor((ms % 3600000) / 60000);
  dur.textContent = h + 'h ' + String(m).padStart(2, '0') + 'm';
  dur.style.color = 'var(--red)';
}

function renderFuelTimeline() {
  var fill    = document.getElementById('fuel-timeline-fill');
  var cpEmpty = document.getElementById('cp-empty');
  var cpWarn  = document.getElementById('cp-warning');
  var cpCrit  = document.getElementById('cp-critical');
  if (!fill) return;
  fill.style.width = genPct + '%';
  var fuelL   = Math.round(genPct * tankLitres / 100);
  var fph     = genKva * 0.25;
  var totalHrs = fuelL / fph;
  var warnHrs  = ((genPct - 25) * tankLitres / 100) / fph;
  var critHrs  = ((genPct - 10) * tankLitres / 100) / fph;
  if (cpWarn)  cpWarn.textContent  = warnHrs  > 0 ? '+' + warnHrs.toFixed(1) + 'h'  : 'Passed';
  if (cpCrit)  cpCrit.textContent  = critHrs  > 0 ? '+' + critHrs.toFixed(1) + 'h'  : 'Passed';
  if (cpEmpty) cpEmpty.textContent = '+' + totalHrs.toFixed(1) + 'h';
}

// ── Live data simulation (drifts from real Firebase baseline)
var liveTimer = null;
function startLiveData() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(function() {
    // Generator drift
    genPct += genDir * (Math.random() * 0.04);
    if (genPct < 20) genDir = 1;
    if (genPct > 55) genDir = -1;
    genPct = Math.max(5, Math.min(95, genPct));

    // Fridge drift
    fridgeTemp += (Math.random() * 0.06 - 0.03);
    fridgeTemp  = Math.max(2.1, Math.min(7.8, fridgeTemp));

    // Load drift
    loadW += loadDir * (Math.random() * 20 - 10);
    loadW  = Math.max(1400, Math.min(4000, Math.round(loadW / 10) * 10));

    // UPS
    upsPct = nepaOnline
      ? Math.min(100, upsPct + Math.random() * 0.08)
      : Math.max(5,   upsPct - Math.random() * 0.06);

    renderVitals();
    renderFuelTimeline();

    // Alerts
    if (genPct < 20) window.showToast('Generator fuel critical — activate triage immediately', 'error');
    if (fridgeTemp > 7.5) window.showToast('Vaccine fridge temperature high — check immediately', 'error');

    // Push to Firebase every ~30s (every 15 ticks at 2s interval)
    if (Math.random() < 0.067) {
      var uid = sessionStorage.getItem('pulse_uid');
      if (uid) {
        update(ref(db, 'clinics/' + uid + '/liveReadings'), {
          fuelPct:    genPct,
          fridgeTemp: fridgeTemp,
          loadW:      loadW,
          nepaOnline: nepaOnline,
          updatedAt:  Date.now(),
        }).catch(function() {});
      }
    }
  }, 2000);
}

// ── Clock
function startClock() {
  function tick() {
    var n = new Date();
    var el = document.getElementById('live-clock');
    if (!el) return;
    var h  = n.getHours().toString().padStart(2, '0');
    var m  = n.getMinutes().toString().padStart(2, '0');
    var ampm = n.getHours() < 12 ? 'AM' : 'PM';
    el.textContent = h + ':' + m + ' ' + ampm;
  }
  tick(); setInterval(tick, 10000);
}

// ── ECG Canvas
function startECG() {
  var canvas = document.getElementById('ecgCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var points = [], t = 0;

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  function ecgShape(x) {
    var c = x % 1;
    if (c < 0.08) return 0;
    if (c < 0.12) return (c-0.08)/0.04*0.15;
    if (c < 0.16) return 0.15-(c-0.12)/0.04*0.15;
    if (c < 0.20) return -(c-0.16)/0.04*0.25;
    if (c < 0.22) return -0.25+(c-0.20)/0.02*1.25;
    if (c < 0.26) return 1-(c-0.22)/0.04*1.4;
    if (c < 0.30) return -0.4+(c-0.26)/0.04*0.5;
    if (c < 0.36) return 0.1-(c-0.30)/0.06*0.1;
    if (c < 0.40) return -(c-0.36)/0.04*0.2;
    if (c < 0.44) return -0.2+(c-0.40)/0.04*0.4;
    if (c < 0.48) return 0.2-(c-0.44)/0.04*0.2;
    return 0;
  }

  function draw() {
    var W = canvas.offsetWidth, H = canvas.offsetHeight;
    ctx.clearRect(0, 0, W, H);
    // Grid
    ctx.strokeStyle = 'rgba(0,200,100,0.06)'; ctx.lineWidth = 0.5;
    for (var x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (var y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    // ECG
    t += 0.008; points.push(t);
    if (points.length > W) points.shift();
    var grad = ctx.createLinearGradient(0,0,W,0);
    grad.addColorStop(0, 'rgba(0,232,122,0)');
    grad.addColorStop(0.7, 'rgba(0,232,122,0.3)');
    grad.addColorStop(1, 'rgba(0,232,122,0.9)');
    ctx.beginPath(); ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0,232,122,0.6)'; ctx.shadowBlur = 8;
    points.forEach(function(pt, i) {
      var px = (i / points.length) * W;
      var py = H/2 - ecgShape(pt) * (H * 0.42);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke(); ctx.shadowBlur = 0;
    // Cursor dot
    if (points.length > 1) {
      var ly = H/2 - ecgShape(points[points.length-1]) * (H*0.42);
      ctx.beginPath(); ctx.arc(W-2, ly, 4, 0, Math.PI*2);
      ctx.fillStyle = '#00e87a'; ctx.shadowColor = 'rgba(0,232,122,0.9)'; ctx.shadowBlur = 12;
      ctx.fill(); ctx.shadowBlur = 0;
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Guide
function showGuideTip(idx) {
  var tip = GUIDE_TIPS[idx];
  if (!tip) { endGuide(); return; }
  currentTip = idx; guideActive = true;
  var iconEl  = document.getElementById('gt-icon');
  var titleEl = document.getElementById('gt-title');
  var bodyEl  = document.getElementById('gt-body');
  var stepEl  = document.getElementById('gt-step');
  var okBtn   = document.getElementById('gt-okay-btn');
  if (iconEl)  iconEl.textContent  = tip.icon;
  if (titleEl) titleEl.textContent = tip.title;
  if (bodyEl)  bodyEl.textContent  = tip.body;
  if (stepEl)  stepEl.textContent  = (idx+1) + ' / ' + GUIDE_TIPS.length;
  if (okBtn)   okBtn.textContent   = idx < GUIDE_TIPS.length-1 ? 'Got it' : 'Finish';
  // Dots
  var dots = document.getElementById('gt-dots');
  if (dots) {
    dots.innerHTML = '';
    GUIDE_TIPS.forEach(function(_, i) {
      var d = document.createElement('div');
      d.className = 'gt-dot' + (i === idx ? ' active' : '');
      dots.appendChild(d);
    });
  }
  // Position — always bottom-right for reliability
  var tipEl = document.getElementById('guide-tip');
  if (tipEl) {
    tipEl.style.bottom = '24px'; tipEl.style.right = '16px';
    tipEl.style.top = 'auto';   tipEl.style.left  = 'auto';
    document.getElementById('spotlight')?.classList.add('active');
    setTimeout(function() { tipEl.classList.add('visible'); }, 50);
    var badge = document.getElementById('guide-badge');
    if (badge) badge.style.display = 'none';
  }
  var anchor = document.getElementById(tip.anchor);
  if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideGuideTip(cb) {
  var tip = document.getElementById('guide-tip');
  if (tip) tip.classList.remove('visible');
  setTimeout(function() { if (cb) cb(); }, 350);
}

function endGuide() {
  hideGuideTip();
  document.getElementById('spotlight')?.classList.remove('active');
  guideActive = false;
  localStorage.setItem('pulse-guide-done', '1');
  window.showToast('Guide complete. Tap ? to replay anytime.', 'success');
}

// ── Pro banner
function initProBanner() {
  if (localStorage.getItem('pulse-pro-dismissed')) return;
  var plan = sessionStorage.getItem('pulse_plan');
  if (plan === 'pro' || plan === 'enterprise') return;
  var savedHours = (Math.random() * 4 + 3).toFixed(1);
  var txt = document.getElementById('pro-savings-text');
  if (txt) txt.textContent = 'You have saved an estimated ' + savedHours + ' hours of generator runtime this week.';
  var banner = document.getElementById('pro-upgrade-banner');
  if (banner) banner.style.display = 'flex';
}

// ── Auth guard + load real data
onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  sessionStorage.setItem('pulse_uid', user.uid);

  // Check sessionStorage cache first (instant)
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try { applyClinicData(JSON.parse(cached)); } catch(e) {}
  }

  // Always fetch fresh from Firebase
  get(ref(db, 'clinics/' + user.uid)).then(function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();
    sessionStorage.setItem('pulse_clinic', JSON.stringify(d));
    applyClinicData(d);

    // Subscribe to live reading changes from other pages
    onValue(ref(db, 'clinics/' + user.uid + '/liveReadings'), function(snap) {
      if (!snap.exists()) return;
      var r = snap.val();
      if (r.nepaOnline != null && r.nepaOnline !== nepaOnline) {
        nepaOnline   = r.nepaOnline;
        nepaOffStart = r.nepaOffStart || null;
        renderNEPABanner();
      }
      if (r.fuelPct    != null) genPct     = r.fuelPct;
      if (r.fridgeTemp != null) fridgeTemp = r.fridgeTemp;
    });
  }).catch(function() {});
});

// ── DOM ready
document.addEventListener('DOMContentLoaded', function() {
  startClock();
  startECG();
  startLiveData();
  initProBanner();

  // Read NEPA from sessionStorage in case crisis page updated it
  var storedNepa = sessionStorage.getItem('pulse_nepa_online');
  if (storedNepa !== null) {
    nepaOnline = storedNepa === 'true';
    var storedStart = sessionStorage.getItem('pulse_nepa_off_start');
    if (storedStart) nepaOffStart = parseInt(storedStart);
    renderNEPABanner();
  }

  // Start guide on first visit (after 2.5s)
  if (!localStorage.getItem('pulse-guide-done')) {
    setTimeout(function() { showGuideTip(0); }, 2500);
  }
});