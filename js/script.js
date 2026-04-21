// ── CURSOR (desktop only) ──────────────────────────────────────────────────
const cur = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;
if (cur) {
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  function animCursor() {
    cur.style.left = mx + 'px'; cur.style.top = my + 'px';
    rx += (mx - rx) * 0.12; ry += (my - ry) * 0.12;
    ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
    requestAnimationFrame(animCursor);
  }
  animCursor();
  document.querySelectorAll('button,a,.demo-step,.screen-card,.lang-card,.modal-lang').forEach(el => {
    el.addEventListener('mouseenter', () => { cur.style.width = '5px'; cur.style.height = '5px'; ring.style.width = '48px'; ring.style.height = '48px'; ring.style.borderColor = 'rgba(0,255,136,0.8)'; });
    el.addEventListener('mouseleave', () => { cur.style.width = '10px'; cur.style.height = '10px'; ring.style.width = '36px'; ring.style.height = '36px'; ring.style.borderColor = 'rgba(0,255,136,0.5)'; });
  });
}

// ── SCROLL REVEAL ──────────────────────────────────────────────────────────
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

// ── DEMO STEP SWITCHER ─────────────────────────────────────────────────────
function setDemo(idx, el) {
  document.querySelectorAll('.demo-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.demo-screen').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ds' + idx).classList.add('active');
}

// ── LANGUAGE MODAL ─────────────────────────────────────────────────────────
let selectedLang = 'en';
const langLabels = { en: 'English', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo' };

function openLangModal() { document.getElementById('langModal').classList.add('open'); }
function closeLangModal() {
  document.getElementById('langModal').classList.remove('open');
  document.getElementById('navLangLabel').textContent = langLabels[selectedLang];
}
function selectLang(el, code) {
  document.querySelectorAll('.modal-lang').forEach(m => m.classList.remove('selected'));
  el.classList.add('selected');
  selectedLang = code;
  window.PULSE_LANG = code;
}
document.getElementById('langModal').addEventListener('click', e => {
  if (e.target === document.getElementById('langModal')) closeLangModal();
});

// ── SECTION LANG CARDS ─────────────────────────────────────────────────────
function setLang(el, code) {
  document.querySelectorAll('.lang-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  selectedLang = code;
  window.PULSE_LANG = code;
  document.getElementById('navLangLabel').textContent = langLabels[code];
}

// ── MOBILE MENU ────────────────────────────────────────────────────────────
function toggleMenu() {
  const m = document.getElementById('mobileMenu');
  m.classList.toggle('open');
}

// ── LIVE GAUGE ANIMATION ───────────────────────────────────────────────────
let fuelLevel = 38, fuelDir = -1;
setInterval(() => {
  fuelLevel += fuelDir * (Math.random() * 0.25);
  if (fuelLevel < 22) fuelDir = 1;
  if (fuelLevel > 44) fuelDir = -1;
  const el = document.getElementById('demoFuel');
  const bar = document.getElementById('demoFuelBar');
  if (el) el.textContent = Math.round(fuelLevel) + '%';
  if (bar) bar.style.width = fuelLevel + '%';
}, 1800);

// ── CRISIS OPTION INTERACTION ──────────────────────────────────────────────
document.querySelectorAll('.c-opt').forEach(opt => {
  opt.addEventListener('click', function() {
    this.closest('.crisis-options').querySelectorAll('.c-opt').forEach(s => s.classList.remove('selected'));
    this.classList.add('selected');
  });
});

// ── NAV ACTIVE STATE ON SCROLL ─────────────────────────────────────────────
const allSections = document.querySelectorAll('section[id]');
const navLinkEls = document.querySelectorAll('.nav-links a');
window.addEventListener('scroll', () => {
  let cur = '';
  allSections.forEach(s => { if (window.scrollY >= s.offsetTop - 130) cur = s.id; });
  navLinkEls.forEach(a => { a.style.color = a.getAttribute('href') === '#' + cur ? 'var(--g1)' : ''; });
}, { passive: true });

// ── PARALLAX ORBS ──────────────────────────────────────────────────────────
window.addEventListener('scroll', () => {
  const y = window.scrollY * 0.08;
  const orbs = document.querySelectorAll('.hero-orb');
  if (orbs[0]) orbs[0].style.transform = `translateX(-50%) translateY(${y}px)`;
  if (orbs[1]) orbs[1].style.transform = `translateY(${y * 0.6}px)`;
  if (orbs[2]) orbs[2].style.transform = `translateY(${y * 1.2}px)`;
}, { passive: true });
