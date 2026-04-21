// pulse-pricing.js
// ─────────────────────────────────────────────────────────────────
// Public page — no Firebase auth required.
// Billing toggle, savings calculator, FAQ accordion, mobile nav.
// All window.* at TOP LEVEL.
// ─────────────────────────────────────────────────────────────────

var isAnnual = false;

var PRICES = {
  monthly: { proRaw: 20000, proDisplay: '20,000' },
  annual:  { proRaw: 16000, proDisplay: '16,000' },
};

// ══════════════════════════════════════════════════════════════════
// window.* — ALL called from HTML onclick / oninput
// ══════════════════════════════════════════════════════════════════

window.toggleBilling = function() {
  isAnnual = !isAnnual;

  var sw     = document.getElementById('billing-switch');
  var mLabel = document.getElementById('monthly-label');
  var aLabel = document.getElementById('annual-label');
  var proPrice= document.getElementById('pro-price');
  var proNote = document.getElementById('pro-annual-note');

  if (sw)       sw.classList.toggle('annual', isAnnual);
  if (mLabel)   mLabel.classList.toggle('active', !isAnnual);
  if (aLabel)   aLabel.classList.toggle('active',  isAnnual);

  if (isAnnual) {
    if (proPrice) proPrice.textContent = PRICES.annual.proDisplay;
    if (proNote)  proNote.textContent  = 'Billed as ₦192,000/year — saving ₦48,000';
  } else {
    if (proPrice) proPrice.textContent = PRICES.monthly.proDisplay;
    if (proNote)  proNote.textContent  = '';
  }

  calcSavings();
};

window.calcSavings = function() {
  var diesel  = parseInt(document.getElementById('c-diesel')?.value)  || 400000;
  var outages = parseInt(document.getElementById('c-outages')?.value) || 12;
  var hrs     = parseInt(document.getElementById('c-hrs')?.value)     || 8;

  var fmt = function(n) { return '₦' + (n >= 1000000 ? (n/1000000).toFixed(1) + 'M' : Math.round(n/1000) + 'k'); };
  var set = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };

  set('c-diesel-lbl',  fmt(diesel));
  set('c-outages-lbl', outages);
  set('c-hrs-lbl',     hrs + ' hrs');

  var annualDiesel  = diesel * 12;
  var fuelSaving    = Math.round(annualDiesel * 0.30);          // 30% diesel reduction via triage
  var revenuePerHr  = 15000;                                    // ₦15k/hr clinic revenue estimate
  var revRecovered  = Math.round(outages * hrs * revenuePerHr * 0.5 * 12); // 50% recovery
  var subCost       = isAnnual ? 192000 : PRICES.monthly.proRaw * 12;
  var netSaving     = fuelSaving + revRecovered - subCost;

  set('cr-fuel', '+' + fmt(fuelSaving));
  set('cr-rev',  '+' + fmt(revRecovered));
  set('cr-cost', '−' + fmt(subCost));
  set('cr-big',   fmt(Math.max(0, netSaving)));
};

window.toggleFAQ = function(qEl) {
  var item   = qEl.closest('.faq-item');
  if (!item) return;
  var isOpen = item.classList.contains('open');
  // Close all
  document.querySelectorAll('.faq-item.open').forEach(function(i) { i.classList.remove('open'); });
  // Open current if it was closed
  if (!isOpen) item.classList.add('open');
};

window.toggleMobileMenu = function() {
  document.getElementById('mobile-nav')?.classList.toggle('open');
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

// ── Run on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  calcSavings();
});