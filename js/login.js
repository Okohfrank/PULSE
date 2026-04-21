// login.js
// ─────────────────────────────────────────────────────────────────
// Handles: email sign-in, Google sign-in, password reset, show/hide
// All window.* at TOP LEVEL so onclick attributes always find them
// ─────────────────────────────────────────────────────────────────

import { auth, provider }               from './firebase-config.js';
import { getDatabase, ref, get }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  onAuthStateChanged,
}                                        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const db = getDatabase();

// ── If already logged in, skip straight to dashboard
onAuthStateChanged(auth, function(user) {
  if (user) {
    // Quietly pre-load clinic data before redirect for speed
    get(ref(db, 'clinics/' + user.uid)).then(function(snap) {
      if (snap.exists()) {
        sessionStorage.setItem('pulse_uid',    user.uid);
        sessionStorage.setItem('pulse_clinic', JSON.stringify(snap.val()));
      }
      window.location.href = 'pulse-dashboard.html';
    }).catch(function() {
      window.location.href = 'pulse-dashboard.html';
    });
  }
});

// ══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS (internal, not called from HTML)
// ══════════════════════════════════════════════════════════════════

function showBanner(id, msg) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  el.style.display = 'block';
}

function clearBanner(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

function setFieldError(inputId, errId, show) {
  var input = document.getElementById(inputId);
  var err   = document.getElementById(errId);
  if (input) input.classList.toggle('err', show);
  if (err)   err.classList.toggle('show', show);
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function friendlyError(code) {
  var map = {
    'auth/user-not-found':          'No account found with this email address.',
    'auth/wrong-password':          'Incorrect password. Please try again.',
    'auth/invalid-credential':      'Incorrect email or password.',
    'auth/invalid-email':           'Please enter a valid email address.',
    'auth/user-disabled':           'This account has been disabled.',
    'auth/too-many-requests':       'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed':  'No internet connection. Check your network.',
    'auth/popup-closed-by-user':    'Google sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Another sign-in is already in progress.',
    'auth/unauthorized-domain':     'Login not allowed from this domain. Add localhost to Firebase → Authentication → Settings → Authorized domains.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function setSignInLoading(on) {
  var btn = document.getElementById('signin-btn');
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? 'Signing in…' : 'Sign In';
  btn.classList.toggle('loading', on);
}

// After successful sign-in: cache clinic data then redirect
function afterSignIn(uid) {
  sessionStorage.setItem('pulse_uid', uid);
  get(ref(db, 'clinics/' + uid)).then(function(snap) {
    if (snap.exists()) {
      sessionStorage.setItem('pulse_clinic', JSON.stringify(snap.val()));
    }
    window.location.href = 'pulse-dashboard.html';
  }).catch(function() {
    window.location.href = 'pulse-dashboard.html';
  });
}

// ══════════════════════════════════════════════════════════════════
// window.* — ALL functions called from HTML onclick
// ══════════════════════════════════════════════════════════════════

window.signIn = function() {
  clearBanner('login-error');
  setFieldError('login-email', 'le-err',  false);
  setFieldError('login-pw',    'lpw-err', false);

  var email = (document.getElementById('login-email') || {}).value || '';
  var pw    = (document.getElementById('login-pw')    || {}).value || '';
  email = email.trim();

  var ok = true;
  if (!validEmail(email)) { setFieldError('login-email', 'le-err',  true); ok = false; }
  if (!pw)                 { setFieldError('login-pw',    'lpw-err', true); ok = false; }
  if (!ok) return;

  setSignInLoading(true);
  clearBanner('login-error');

  signInWithEmailAndPassword(auth, email, pw)
    .then(function(cred) { afterSignIn(cred.user.uid); })
    .catch(function(err) {
      setSignInLoading(false);
      showBanner('login-error', friendlyError(err.code));
    });
};

window.signInGoogle = function() {
  clearBanner('login-error');
  signInWithPopup(auth, provider)
    .then(function(cred) { afterSignIn(cred.user.uid); })
    .catch(function(err) {
      showBanner('login-error', friendlyError(err.code));
    });
};

window.showForgot = function() {
  document.getElementById('login-panel')?.classList.add('hidden');
  var fp = document.getElementById('fp-panel');
  if (fp) fp.classList.add('active');
  document.getElementById('fp-email')?.focus();
};

window.showLogin = function() {
  var fp = document.getElementById('fp-panel');
  if (fp) fp.classList.remove('active');
  document.getElementById('login-panel')?.classList.remove('hidden');
  document.getElementById('reset-sent')?.classList.remove('visible');
  var fpForm = document.getElementById('fp-form');
  if (fpForm) fpForm.style.display = '';
  var fpEmail = document.getElementById('fp-email');
  if (fpEmail) fpEmail.value = '';
  clearBanner('fp-error');
};

window.sendReset = function() {
  clearBanner('fp-error');
  setFieldError('fp-email', 'fpe-err', false);

  var email = (document.getElementById('fp-email') || {}).value || '';
  email = email.trim();
  if (!validEmail(email)) {
    setFieldError('fp-email', 'fpe-err', true);
    return;
  }

  var btn = document.getElementById('reset-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; btn.classList.add('loading'); }

  sendPasswordResetEmail(auth, email)
    .then(function() {
      var fpForm = document.getElementById('fp-form');
      if (fpForm) fpForm.style.display = 'none';
      var sub = document.getElementById('rs-sub-text');
      if (sub) sub.textContent = 'A reset link was sent to ' + email + '. Check your inbox — expires in 1 hour.';
      document.getElementById('reset-sent')?.classList.add('visible');
    })
    .catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; btn.classList.remove('loading'); }
      showBanner('fp-error', friendlyError(err.code));
    });
};

window.togglePw = function() {
  var inp = document.getElementById('login-pw');
  var lbl = document.getElementById('pw-toggle-label');
  if (!inp || !lbl) return;
  if (inp.type === 'password') { inp.type = 'text';     lbl.textContent = 'hide'; }
  else                         { inp.type = 'password'; lbl.textContent = 'show'; }
};

window.toggleRemember = function() {
  document.getElementById('remember-wrap')?.classList.toggle('checked');
};

window.toggleGuide = function() {
  var guide = document.getElementById('admin-guide');
  var btn   = document.getElementById('guide-toggle-btn');
  if (!guide) return;
  var isOpen = guide.classList.toggle('open');
  if (btn) btn.textContent = isOpen ? 'Hide Firebase Admin Guide ↑' : 'View Firebase Admin Guide ↓';
  if (isOpen) setTimeout(function() { guide.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
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
  t._timer = setTimeout(function() { t.classList.remove('show'); }, 3200);
};

// ══════════════════════════════════════════════════════════════════
// DOM READY — attach live-validation listeners only
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
  // Clear field errors as user types
  var emailEl = document.getElementById('login-email');
  var pwEl    = document.getElementById('login-pw');
  var fpEmail = document.getElementById('fp-email');

  if (emailEl) emailEl.addEventListener('input', function() {
    setFieldError('login-email', 'le-err', false);
    clearBanner('login-error');
  });
  if (pwEl) pwEl.addEventListener('input', function() {
    setFieldError('login-pw', 'lpw-err', false);
    clearBanner('login-error');
  });
  if (fpEmail) fpEmail.addEventListener('input', function() {
    setFieldError('fp-email', 'fpe-err', false);
    clearBanner('fp-error');
  });

  // Enter key shortcuts
  if (pwEl)    pwEl.addEventListener('keydown',    function(e) { if (e.key === 'Enter') window.signIn(); });
  if (fpEmail) fpEmail.addEventListener('keydown', function(e) { if (e.key === 'Enter') window.sendReset(); });
});