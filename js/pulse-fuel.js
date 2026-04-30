// pulse-fuel.js
// ─────────────────────────────────────────────────────────────────
// Fuel Manager — external JS companion to pulse_fuel.html
// If the page already has an inline <script type="module">, this
// file is NOT needed. Only use this if you move the JS outside.
// All window.* at TOP LEVEL. No async/await for critical paths.
// ─────────────────────────────────────────────────────────────────
// This file mirrors the inline script exactly so you can use either.
// To activate: replace the inline <script> block in pulse_fuel.html
// with: <script type="module" src="js/pulse-fuel.js"></script>
// ─────────────────────────────────────────────────────────────────

import { auth }                     from './firebase-config.js';
import { getDatabase, ref,
         get, push, update,
         onValue, query,
         orderByChild, limitToLast } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── State
var uid            = null;
var CLINIC         = { genKva:20, tankL:200, fuelType:'Diesel (AGO)', name:'My Clinic' };
var currentFuelPct = 38;
var pricePerLitre  = 750;
var refuelHistory  = [];

// ══════════════════════════════════════════════════════════════════
// window.* — ALL at TOP LEVEL
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
  var t = document.getElementById('toast'), m = document.getElementById('toast-msg');
  if (!t || !m) return;
  t.className = 'toast ' + type; m.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(function() { t.classList.remove('show'); }, 3600);
};

window.onFormChange = function() {
  autoFillCost();
  validateForm();
};

window.setManualPrice = function() {
  var input = document.getElementById('pt-manual-input');
  var val   = parseFloat(input?.value);
  if (!val || val < 100 || val > 5000) {
    window.showToast('Enter a valid price between ₦100 and ₦5,000 per litre', 'error');
    return;
  }
  pricePerLitre = val;
  if (input) input.value = '';
  updatePriceDisplay(val, 'Manual entry');
  autoFillCost();
  window.showToast('Fuel price updated to ₦' + val + '/L', 'success');
  if (uid) {
    update(ref(db, 'clinics/' + uid), {
      lastFuelPrice: val,
      lastFuelPriceSource: 'manual',
    }).catch(function() {});
  }
};

window.submitRefuel = function() {
  var validation = runValidation();
  if (!validation.canSubmit) {
    window.showToast('Please fix the errors before logging', 'error');
    return;
  }

  var litres   = parseFloat(document.getElementById('f-litres')?.value)   || 0;
  var cost     = parseFloat(document.getElementById('f-cost')?.value)     || 0;
  var supplier = (document.getElementById('f-supplier')?.value || '').trim() || 'Unknown supplier';
  var fuelType = document.getElementById('f-fueltype')?.value || CLINIC.fuelType;
  var before   = parseFloat(document.getElementById('f-before')?.value);
  var notes    = (document.getElementById('f-notes')?.value || '').trim();

  setSubmitLoading(true);

  var newFuelPct = Math.min(100, (isNaN(before) ? currentFuelPct : before) + (litres / CLINIC.tankL * 100));
  var pricePerL  = (cost > 0 && litres > 0) ? cost / litres : pricePerLitre;
  var flagged    = validation.flags.length > 0;

  var entry = {
    litres:        litres,
    cost:          cost,
    pricePerLitre: pricePerL,
    supplier:      supplier,
    fuelType:      fuelType,
    fuelBefore:    isNaN(before) ? currentFuelPct : before,
    fuelAfter:     Math.round(newFuelPct),
    notes:         notes,
    timestamp:     Date.now(),
    flagged:       flagged,
    flags:         validation.flags,
    loggedBy:      uid,
  };

  if (!uid) { window.showToast('Not logged in', 'error'); setSubmitLoading(false); return; }

  push(ref(db, 'clinics/' + uid + '/fuelLogs'), entry)
    .then(function() {
      return update(ref(db, 'clinics/' + uid + '/liveReadings'), {
        fuelPct:          newFuelPct,
        lastRefuelTime:   Date.now(),
        lastRefuelLitres: litres,
        updatedAt:        Date.now(),
      });
    })
    .then(function() {
      // Update sessionStorage cache
      var cached = sessionStorage.getItem('pulse_clinic');
      if (cached) {
        try {
          var c = JSON.parse(cached);
          if (!c.liveReadings) c.liveReadings = {};
          c.liveReadings.fuelPct = newFuelPct;
          sessionStorage.setItem('pulse_clinic', JSON.stringify(c));
        } catch(e) {}
      }
      sessionStorage.setItem('pulse_fuel_pct', Math.round(newFuelPct).toString());
      currentFuelPct = newFuelPct;
      updateGauge(newFuelPct);
      showSuccessOverlay(litres, newFuelPct);
      clearForm();
      loadHistory();
      setSubmitLoading(false);
    })
    .catch(function(e) {
      window.showToast('Save failed: ' + e.message, 'error');
      setSubmitLoading(false);
    });
};

window.closeSuccess = function() {
  document.getElementById('success-overlay')?.classList.remove('show');
};

window.submitRecalibration = function() {
  var input = document.getElementById('recal-input');
  var val   = parseFloat(input?.value);
  if (isNaN(val) || val < 0 || val > 100) {
    window.showToast('Enter a value between 0 and 100', 'error');
    return;
  }
  if (!uid) return;

  push(ref(db, 'clinics/' + uid + '/calibrationLogs'), {
    type: 'calibration', fuelBefore: currentFuelPct,
    fuelAfter: val, timestamp: Date.now(), loggedBy: uid,
  }).then(function() {
    return update(ref(db, 'clinics/' + uid + '/liveReadings'), { fuelPct: val, updatedAt: Date.now() });
  }).then(function() {
    currentFuelPct = val;
    sessionStorage.setItem('pulse_fuel_pct', Math.round(val).toString());
    updateGauge(val);
    if (input) input.value = '';
    var preview = document.getElementById('recal-preview');
    if (preview) preview.textContent = '';
    var btn = document.getElementById('recal-btn');
    if (btn) btn.disabled = true;
    window.showToast('Gauge recalibrated to ' + Math.round(val) + '%', 'success');
  }).catch(function(e) { window.showToast('Error: ' + e.message, 'error'); });
};

window.onRecalChange = function() {
  var input   = document.getElementById('recal-input');
  var btn     = document.getElementById('recal-btn');
  var preview = document.getElementById('recal-preview');
  var val     = parseFloat(input?.value);
  if (!isNaN(val) && val >= 0 && val <= 100) {
    var litres = Math.round(val * CLINIC.tankL / 100);
    var diff   = Math.round(val - currentFuelPct);
    if (preview) preview.textContent = litres + 'L — ' + (diff >= 0 ? '+' : '') + diff + '% from current';
    if (btn) btn.disabled = false;
  } else {
    if (preview) preview.textContent = '';
    if (btn) btn.disabled = true;
  }
};

// ══════════════════════════════════════════════════════════════════
// INTERNAL FUNCTIONS
// ══════════════════════════════════════════════════════════════════

function setSubmitLoading(on) {
  var btn   = document.getElementById('submit-btn');
  var label = document.getElementById('submit-label');
  var icon  = document.getElementById('submit-icon');
  if (on) {
    if (btn)   { btn.classList.add('loading'); btn.disabled = true; }
    if (label) label.textContent = 'Saving...';
    if (icon)  icon.innerHTML    = '<div class="btn-spin"></div>';
  } else {
    if (btn)   { btn.classList.remove('loading'); btn.disabled = true; }
    if (label) label.textContent = 'Log Refuel';
    if (icon)  icon.textContent  = '⛽';
  }
}

function autoFillCost() {
  var litresEl = document.getElementById('f-litres');
  var costEl   = document.getElementById('f-cost');
  var prev     = document.getElementById('cost-preview');
  var cpVal    = document.getElementById('cp-val');
  var cpRate   = document.getElementById('cp-price-rate');
  var litres   = parseFloat(litresEl?.value);
  if (litres > 0) {
    var calc = Math.round(litres * pricePerLitre);
    if (!costEl?.value) { if (costEl) costEl.value = calc; }
    if (cpRate) cpRate.textContent = Math.round(pricePerLitre);
    if (cpVal)  cpVal.textContent  = '₦' + calc.toLocaleString();
    if (prev)   prev.style.display = 'flex';
  } else {
    if (prev) prev.style.display = 'none';
  }
}

function runValidation() {
  var litres  = parseFloat(document.getElementById('f-litres')?.value)  || 0;
  var cost    = parseFloat(document.getElementById('f-cost')?.value)     || 0;
  var before  = parseFloat(document.getElementById('f-before')?.value);
  var panel   = document.getElementById('validation-panel');
  var vpHead  = document.getElementById('vp-head');
  var vpItems = document.getElementById('vp-items');

  var checks = [], flags = [], errors = [];

  if (litres <= 0) { errors.push('litres'); }

  if (litres > CLINIC.tankL) {
    flags.push('Litres (' + litres + 'L) exceeds tank capacity (' + CLINIC.tankL + 'L). Not physically possible.');
    errors.push('litres');
  }

  if (!isNaN(before)) {
    var expectedAfter = before + (litres / CLINIC.tankL * 100);
    if (expectedAfter > 105) {
      flags.push('"Before" level (' + Math.round(before) + '%) + litres added would overflow the tank. Check numbers.');
    }
    var deviation = Math.abs(before - currentFuelPct);
    if (deviation > 35) {
      flags.push('"Before" level (' + Math.round(before) + '%) is far from current tracked level (' + Math.round(currentFuelPct) + '%). Unusual deviation.');
    }
    checks.push({ pass: deviation <= 35, text: '"Before" level matches tracked reading (' + Math.round(currentFuelPct) + '%)' });
  }

  if (cost > 0 && litres > 0) {
    var ppl    = cost / litres;
    var minPPL = pricePerLitre * 0.5;
    var maxPPL = pricePerLitre * 2.5;
    var valid  = ppl >= minPPL && ppl <= maxPPL;
    if (!valid) flags.push('Price per litre (₦' + Math.round(ppl) + '/L) outside expected range (₦' + Math.round(minPPL) + '–₦' + Math.round(maxPPL) + '/L).');
    checks.push({ pass: valid, text: 'Cost per litre (₦' + Math.round(ppl) + '/L) within range' });
  }

  // Duplicate check — last 30 mins
  var recentDup = refuelHistory.find(function(r) { return Date.now() - r.timestamp < 30 * 60 * 1000; });
  if (recentDup) flags.push('A refuel was logged within the last 30 minutes. Possible duplicate.');

  // Monthly volume check
  var monthAgo      = Date.now() - 30 * 24 * 3600000;
  var monthlyLitres = refuelHistory.filter(function(r) { return r.timestamp > monthAgo; }).reduce(function(s,r) { return s + (r.litres||0); }, 0);
  var maxMonthly    = CLINIC.tankL * 8;
  if (monthlyLitres + litres > maxMonthly) {
    flags.push('Monthly total (' + Math.round(monthlyLitres + litres) + 'L) unusually high for a ' + CLINIC.tankL + 'L tank system.');
  }

  checks.push({ pass: litres <= CLINIC.tankL, text: 'Litres within tank capacity (' + CLINIC.tankL + 'L)' });
  checks.push({ pass: litres > 0, text: 'Litres value provided' });

  var canSubmit = errors.length === 0 && litres > 0;

  if (panel && vpHead && vpItems && litres > 0) {
    panel.classList.add('show');
    vpHead.className = 'vp-head ' + (errors.length > 0 ? 'fail' : flags.length > 0 ? 'warn' : 'pass');
    vpHead.textContent = errors.length > 0 ? '✗ Fix errors before submitting' : flags.length > 0 ? '⚠ Warnings — review before submitting' : '✓ Entry looks valid';
    vpItems.innerHTML  = checks.map(function(c) {
      return '<div class="vp-item"><span class="vp-ico">' + (c.pass ? '✓' : '✗') + '</span>' + c.text + '</div>';
    }).concat(flags.map(function(f) {
      return '<div class="vp-item" style="color:var(--amber)"><span class="vp-ico">⚠</span>' + f + '</div>';
    })).join('');
  }

  var btn = document.getElementById('submit-btn');
  if (btn) btn.disabled = !canSubmit;

  return { canSubmit:canSubmit, flags:flags, errors:errors };
}

function validateForm() { runValidation(); }

function clearForm() {
  ['f-litres','f-cost','f-supplier','f-before','f-notes'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var cp = document.getElementById('cost-preview');
  if (cp) cp.style.display = 'none';
  var vp = document.getElementById('validation-panel');
  if (vp) vp.classList.remove('show');
  var btn = document.getElementById('submit-btn');
  if (btn) btn.disabled = true;
}

function showSuccessOverlay(litres, newPct) {
  var overlay  = document.getElementById('success-overlay');
  var soLitres = document.getElementById('so-litres');
  var soSub    = document.getElementById('so-sub');
  var soRuntime= document.getElementById('so-runtime');
  var fuelL    = Math.round(newPct * CLINIC.tankL / 100);
  var runtime  = (fuelL / (CLINIC.genKva * 0.25)).toFixed(1);
  if (soLitres)  soLitres.textContent  = litres;
  if (soRuntime) soRuntime.textContent = '⏱ Est. generator runtime: ' + runtime + ' hours';
  if (soSub)     soSub.textContent     = 'New fuel level: ' + Math.round(newPct) + '% (' + fuelL + 'L). Dashboard gauge updated.';
  if (overlay)   overlay.classList.add('show');
}

function updateGauge(pct) {
  pct = Math.max(0, Math.min(100, pct));
  var fill      = document.getElementById('gauge-fill');
  var pctText   = document.getElementById('gauge-pct-text');
  var meta      = document.getElementById('gauge-meta');
  var gvLitres  = document.getElementById('gv-litres');
  var gvRuntime = document.getElementById('gv-runtime');
  var gvBurn    = document.getElementById('gv-burnrate');
  var gvCost    = document.getElementById('gv-cost');
  var projWarn  = document.getElementById('proj-warn');
  var projCrit  = document.getElementById('proj-crit');
  var projEmpty = document.getElementById('proj-empty');
  var projOrder = document.getElementById('proj-order');
  var projMonth = document.getElementById('proj-monthly');

  var colour = pct < 10
    ? 'linear-gradient(90deg,var(--red),#e86070)'
    : 'linear-gradient(90deg,var(--amber),var(--fuel))';

  if (fill)    { fill.style.width = pct + '%'; fill.style.background = colour; }
  if (pctText) pctText.textContent = Math.round(pct) + '%';

  var litres  = Math.round(pct * CLINIC.tankL / 100);
  var fph     = CLINIC.genKva * 0.25;
  var runtime = (litres / fph).toFixed(1);
  var dailyL  = fph * 16; // assume 16h generator use per day
  var dailyC  = Math.round(dailyL * pricePerLitre);

  if (meta)     meta.textContent = litres + 'L remaining in ' + CLINIC.tankL + 'L tank — ' + (pct < 10 ? '🚨 Critical level' : pct < 25 ? '⚠ Below warning threshold' : 'Normal range');
  if (gvLitres) gvLitres.textContent  = litres + 'L';
  if (gvRuntime)gvRuntime.textContent = runtime + 'h';
  if (gvBurn)   gvBurn.textContent    = fph.toFixed(1) + 'L/h';
  if (gvCost)   gvCost.textContent    = '₦' + dailyC.toLocaleString();

  var fmtTime = function(hrs) {
    if (hrs <= 0) return 'Passed';
    if (hrs < 1)  return Math.round(hrs * 60) + ' min';
    if (hrs < 24) return hrs.toFixed(1) + 'h';
    return Math.round(hrs / 24) + 'd';
  };

  var warnHrs  = ((pct - 25) * CLINIC.tankL / 100) / fph;
  var critHrs  = ((pct - 10) * CLINIC.tankL / 100) / fph;
  var emptyHrs = (pct * CLINIC.tankL / 100) / fph;

  if (projWarn)  projWarn.textContent  = warnHrs  > 0 ? 'In ' + fmtTime(warnHrs) : '⚠ Already below 25%';
  if (projCrit)  projCrit.textContent  = critHrs  > 0 ? 'In ' + fmtTime(critHrs) : '🚨 Already below 10%';
  if (projEmpty) projEmpty.textContent = 'In ' + fmtTime(emptyHrs);

  var reorderDays = Math.max(0, (warnHrs - 72) / 24);
  if (projOrder) projOrder.textContent = reorderDays <= 0 ? 'Order now' : 'In ' + Math.round(reorderDays) + 'd';
  if (projMonth) projMonth.textContent = '₦' + Math.round(dailyC * 30).toLocaleString();
}

function updatePriceDisplay(price, source) {
  var priceEl  = document.getElementById('pt-price');
  var sourceEl = document.getElementById('pt-source');
  var dotEl    = document.getElementById('pt-dot');
  var statusEl = document.getElementById('pt-status-txt');
  if (priceEl)  priceEl.textContent  = '₦' + Math.round(price) + '/L';
  if (sourceEl) sourceEl.textContent = '· ' + source;
  if (dotEl)    dotEl.className      = 'pt-dot';
  if (statusEl) statusEl.textContent = 'Updated';
}

function loadHistory() {
  if (!uid) return;
  var histRef = query(
    ref(db, 'clinics/' + uid + '/fuelLogs'),
    orderByChild('timestamp'),
    limitToLast(30)
  );
  get(histRef).then(function(snap) {
    if (!snap.exists()) {
      refuelHistory = [];
      renderHistory([]);
      computeStats();
      return;
    }
    var entries = [];
    snap.forEach(function(child) {
      entries.push(Object.assign({ _key: child.key }, child.val()));
    });
    entries.sort(function(a,b) { return b.timestamp - a.timestamp; });
    refuelHistory = entries;
    renderHistory(entries);
    computeStats();
    checkAnomalies(entries);
    renderChart(entries);
  }).catch(function() {});
}

function renderHistory(entries) {
  var list = document.getElementById('history-list');
  var sub  = document.getElementById('history-sub');
  var fb   = document.getElementById('fraud-badge');
  if (!list) return;

  var flagCount = entries.filter(function(e) { return e.flagged; }).length;
  if (sub) sub.textContent = entries.length + ' refuel' + (entries.length !== 1 ? 's' : '') + ' logged';
  if (fb)  fb.style.display = flagCount > 0 ? 'inline-block' : 'none';

  if (entries.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:24px;font-size:13px;color:var(--dim)">No refuels logged yet. Log your first refuel above.</div>';
    return;
  }

  list.innerHTML = '<div class="history-list">' + entries.slice(0,15).map(function(e) {
    var ago    = (Date.now() - e.timestamp) / 3600000;
    var agoStr = ago < 1 ? Math.round(ago*60) + ' min ago' : ago < 24 ? Math.round(ago) + 'h ago' : Math.round(ago/24) + 'd ago';
    var date   = new Date(e.timestamp).toLocaleDateString('en-NG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    return '<div class="hist-item ' + (e.flagged ? 'flagged' : '') + '">'
      + '<div class="hi-icon ' + (e.flagged ? 'flagged' : '') + '">' + (e.flagged ? '⚠' : '⛽') + '</div>'
      + '<div class="hi-body">'
      + '<div class="hi-title">' + (e.litres||0) + 'L — ' + (e.supplier||'Unknown') + '</div>'
      + '<div class="hi-meta">' + date + ' · ' + (e.fuelType||'Diesel') + ' · ' + Math.round(e.fuelBefore||0) + '% → ' + Math.round(e.fuelAfter||0) + '%</div>'
      + (e.notes ? '<div style="font-size:10px;color:var(--dim);margin-top:2px">' + e.notes + '</div>' : '')
      + (e.flagged ? '<div class="hi-flag">⚠ Flagged</div>' : '')
      + '</div>'
      + '<div class="hi-right">'
      + '<div class="hi-litres">+' + (e.litres||0) + 'L</div>'
      + '<div class="hi-cost">₦' + ((e.cost||0).toLocaleString()) + '</div>'
      + '</div></div>';
  }).join('') + '</div>';
}

function computeStats() {
  var monthAgo     = Date.now() - 30 * 24 * 3600000;
  var monthly      = refuelHistory.filter(function(e) { return e.timestamp > monthAgo; });
  var totLitres    = monthly.reduce(function(s,e) { return s + (e.litres||0); }, 0);
  var totCost      = monthly.reduce(function(s,e) { return s + (e.cost||0);   }, 0);
  var avgPPL       = totLitres > 0 ? totCost / totLitres : 0;
  var dailyAvg     = totLitres > 0 ? (totLitres / 30).toFixed(1) : 0;
  var fmt          = function(n) { return n >= 1000000 ? '₦' + (n/1000000).toFixed(1) + 'M' : n >= 1000 ? '₦' + Math.round(n/1000) + 'k' : '₦' + n; };
  var set          = function(id,v) { var e=document.getElementById(id); if(e) e.textContent=v; };

  set('stat-refuels', monthly.length);
  set('stat-litres',  Math.round(totLitres) + 'L');
  set('stat-cost',    fmt(Math.round(totCost)));
  set('stat-ppl',     avgPPL > 0 ? '₦' + Math.round(avgPPL) + '/L' : '—');
  set('stat-daily',   dailyAvg > 0 ? dailyAvg + 'L/day' : '—');
  set('hero-refuels', monthly.length);
  set('hero-spent',   fmt(Math.round(totCost)));
  set('hero-litres',  Math.round(totLitres) + 'L');
  set('stat-nepa',    '—');
}

function checkAnomalies(entries) {
  var list = document.getElementById('anomaly-list');
  if (!list) return;
  var issues = [];

  entries.slice(0,10).forEach(function(e) {
    if (e.flagged && e.flags && Array.isArray(e.flags)) {
      e.flags.forEach(function(f) { issues.push(f); });
    }
  });

  var prices = entries.filter(function(e) { return e.pricePerLitre > 0; }).map(function(e) { return e.pricePerLitre; });
  if (prices.length > 2) {
    var avg = prices.reduce(function(s,p) { return s+p; },0) / prices.length;
    prices.forEach(function(p) {
      if (p > avg * 1.4) issues.push('Price spike: ₦' + Math.round(p) + '/L is 40%+ above your average of ₦' + Math.round(avg) + '/L.');
    });
  }

  for (var i = 0; i < entries.length-1; i++) {
    if (Math.abs(entries[i].timestamp - entries[i+1].timestamp) < 30 * 60 * 1000) {
      issues.push('Two refuels logged within 30 minutes. Possible duplicate entry at ' + new Date(entries[i].timestamp).toLocaleTimeString() + '.');
      break;
    }
  }

  var unique = [...new Set(issues)].slice(0, 4);
  if (unique.length === 0) {
    list.innerHTML = '<div class="no-anomaly">✓ No anomalies detected across recent entries</div>';
  } else {
    list.innerHTML = unique.map(function(issue) {
      return '<div class="anomaly-item"><div class="ai-dot"></div><span>' + issue + '</span></div>';
    }).join('');
  }
}

function renderChart(entries) {
  var canvas = document.getElementById('chart-canvas');
  var empty  = document.getElementById('chart-empty');
  if (!canvas) return;
  if (entries.length === 0) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
  var W = canvas.offsetWidth, H = canvas.offsetHeight;

  var days  = 30;
  var daily = {};
  for (var i = 0; i < days; i++) {
    daily[new Date(Date.now() - i * 86400000).toDateString()] = 0;
  }
  entries.forEach(function(e) {
    var k = new Date(e.timestamp).toDateString();
    if (k in daily) daily[k] += (e.litres || 0);
  });
  var values = Object.keys(daily).reverse().map(function(k) { return daily[k]; });
  var maxVal = Math.max.apply(null, values.concat([1]));
  var barW   = (W - 20) / days;
  var barGap = barW * 0.25;
  var barFull= barW - barGap;

  ctx.clearRect(0, 0, W, H);
  values.forEach(function(val, i) {
    var x    = 10 + i * barW;
    var barH = (val / maxVal) * (H - 24);
    var y    = H - barH - 20;
    ctx.fillStyle = val > 0 ? 'rgba(245,158,11,0.75)' : 'rgba(46,80,64,0.3)';
    ctx.beginPath();
    ctx.roundRect(x, y, barFull, barH + 1, 2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(106,158,130,0.6)';
  ctx.font = '9px Arial';
  ctx.textAlign = 'center';
  [0, 7, 14, 21, 29].forEach(function(i) {
    var d = new Date(Date.now() - (29-i) * 86400000);
    ctx.fillText((d.getMonth()+1) + '/' + d.getDate(), 10 + i * barW + barFull/2, H - 4);
  });
}

function fetchLivePrice() {
  var dotEl    = document.getElementById('pt-dot');
  var statusEl = document.getElementById('pt-status-txt');
  if (dotEl)    dotEl.className       = 'pt-dot loading';
  if (statusEl) statusEl.textContent = 'Fetching live price...';

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         window.PULSE_API_KEY || '',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role:    'user',
        content: 'What is the current NNPC pump price for diesel (AGO) in Nigeria in Naira per litre? Reply with ONLY a JSON object: {"price": 1200, "source": "NNPC 2025", "note": "Approximate"}'
      }]
    })
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      var text = ((data.content || [])[0] || {}).text || '';
      try {
        var parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
        if (parsed.price && parsed.price > 100) {
          pricePerLitre = parsed.price;
          updatePriceDisplay(parsed.price, parsed.source || 'AI estimate');
          if (uid) update(ref(db,'clinics/'+uid), { lastFuelPrice: parsed.price, lastFuelPriceSource:'ai' }).catch(function(){});
          return;
        }
      } catch(e) {}
      useFallbackPrice();
    })
    .catch(function() { useFallbackPrice(); });
}

function useFallbackPrice() {
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try {
      var c = JSON.parse(cached);
      if (c.lastFuelPrice) {
        pricePerLitre = c.lastFuelPrice;
        updatePriceDisplay(c.lastFuelPrice, c.lastFuelPriceSource === 'manual' ? 'Your last manual entry' : 'Last known price');
        return;
      }
    } catch(e) {}
  }
  updatePriceDisplay(750, 'Default estimate — update manually above');
  var dotEl = document.getElementById('pt-dot');
  if (dotEl) dotEl.className = 'pt-dot err';
  var statusEl = document.getElementById('pt-status-txt');
  if (statusEl) statusEl.textContent = 'Enter price manually';
}

function startClock() {
  function tick() {
    var el = document.getElementById('live-clock');
    if (!el) return;
    var n = new Date();
    el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
  }
  tick(); setInterval(tick, 10000);
}

function applyClinicData(d) {
  CLINIC.genKva   = parseFloat(d.generatorKva) || CLINIC.genKva;
  CLINIC.tankL    = parseFloat(d.tankLitres)   || CLINIC.tankL;
  CLINIC.name     = d.clinicName  || CLINIC.name;
  CLINIC.fuelType = d.fuelType    || CLINIC.fuelType;

  if (d.liveReadings?.fuelPct != null) currentFuelPct = d.liveReadings.fuelPct;
  if (d.lastFuelPrice)                 pricePerLitre  = d.lastFuelPrice;

  var sbClinic = document.getElementById('sb-clinic');
  var sbMeta   = document.getElementById('sb-meta');
  var heroName = document.getElementById('clinic-name-hero');
  var maxHint  = document.getElementById('max-litres-hint');
  var av       = document.getElementById('tb-avatar');
  var fuelSel  = document.getElementById('f-fueltype');

  if (sbClinic) sbClinic.textContent = CLINIC.name;
  if (sbMeta)   sbMeta.textContent   = (d.lga||'') + ', ' + (d.state||'') + ' · ' + (d.facilityType||'PHC');
  if (heroName) heroName.textContent = CLINIC.name;
  if (maxHint)  maxHint.textContent  = CLINIC.tankL + 'L';
  if (av && d.firstName && d.lastName) av.textContent = (d.firstName[0] + d.lastName[0]).toUpperCase();
  if (fuelSel && CLINIC.fuelType) fuelSel.value = CLINIC.fuelType;
}

// ── AUTH GUARD + INIT ──────────────────────────────────────────

onAuthStateChanged(auth, function(user) {
  if (!user) { window.location.href = 'pulse_login.html'; return; }
  uid = user.uid;
  sessionStorage.setItem('pulse_uid', uid);

  // Apply cached data immediately
  var cached = sessionStorage.getItem('pulse_clinic');
  if (cached) {
    try { applyClinicData(JSON.parse(cached)); } catch(e) {}
  }

  // Fetch fresh from Firebase
  get(ref(db, 'clinics/' + uid)).then(function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();
    sessionStorage.setItem('pulse_clinic', JSON.stringify(d));
    applyClinicData(d);
    updateGauge(currentFuelPct);
  }).catch(function() {});

  // Subscribe to live fuel level
  onValue(ref(db, 'clinics/' + uid + '/liveReadings/fuelPct'), function(snap) {
    if (snap.exists()) {
      currentFuelPct = snap.val();
      updateGauge(currentFuelPct);
    }
  });

  loadHistory();
});

document.addEventListener('DOMContentLoaded', function() {
  startClock();
  updateGauge(currentFuelPct);
  fetchLivePrice();
});