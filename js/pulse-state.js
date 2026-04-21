// js/pulse-state.js
// ─────────────────────────────────────────────────────────────
// Shared state layer — reads from and writes to Firebase.
// Import this on every page that needs live clinic data.
// ─────────────────────────────────────────────────────────────
import { auth }                from './firebase-config.js';
import { getDatabase, ref,
         set, get, update,
         onValue }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { onAuthStateChanged }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

export const db = getDatabase();

// ── In-memory state object (updated from Firebase in real time)
export const STATE = {
  uid:           null,
  clinicName:    'Loading...',
  adminName:     'Loading...',
  firstName:     '',
  location:      '',
  type:          '',
  genKva:        20,
  tankLitres:    200,
  fuelPct:       38,
  fridgeTemp:    4.8,
  loadW:         2840,
  nepaOnline:    false,
  nepaOffStart:  null,   // timestamp when NEPA went offline
  protocol:      'Routine',
  appliances:    [],
  plan:          'free',
};

// ── Called once on page load — resolves when auth + data ready
export function initState(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Not logged in — redirect to login
      if (!window.location.pathname.includes('login') &&
          !window.location.pathname.includes('onboarding') &&
          !window.location.pathname.includes('index') &&
          !window.location.pathname.includes('pricing')) {
        window.location.href = 'pulse_login.html';
      }
      return;
    }

    STATE.uid = user.uid;

    // Load clinic profile once
    const snap = await get(ref(db, 'clinics/' + user.uid));
    if (snap.exists()) {
      const d = snap.val();
      STATE.clinicName  = d.clinicName  || 'My Clinic';
      STATE.firstName   = d.firstName   || '';
      STATE.adminName   = (d.firstName || '') + ' ' + (d.lastName || '');
      STATE.location    = (d.lga || '') + ', ' + (d.state || '');
      STATE.type        = d.facilityType || 'PHC';
      STATE.genKva      = d.generatorKva  || 20;
      STATE.tankLitres  = d.tankLitres    || 200;
      STATE.plan        = d.plan          || 'free';
    }

    // Load appliances
    const appSnap = await get(ref(db, 'clinics/' + user.uid + '/appliances'));
    if (appSnap.exists()) {
      STATE.appliances = Object.values(appSnap.val());
    }

    // Subscribe to live readings (fuel, fridge, NEPA etc.)
    // These update in real time as other pages write them
    onValue(ref(db, 'clinics/' + user.uid + '/liveReadings'), (snap) => {
      if (snap.exists()) {
        const r = snap.val();
        STATE.fuelPct     = r.fuelPct     ?? STATE.fuelPct;
        STATE.fridgeTemp  = r.fridgeTemp  ?? STATE.fridgeTemp;
        STATE.loadW       = r.loadW       ?? STATE.loadW;
        STATE.nepaOnline  = r.nepaOnline  ?? STATE.nepaOnline;
        STATE.nepaOffStart= r.nepaOffStart ?? STATE.nepaOffStart;
        STATE.protocol    = r.protocol    ?? STATE.protocol;
      }
    });

    if (onReady) onReady(STATE);
  });
}

// ── Write a live reading update (call from any page)
export async function writeLiveReading(updates) {
  if (!STATE.uid) return;
  await update(ref(db, 'clinics/' + STATE.uid + '/liveReadings'), {
    ...updates,
    updatedAt: Date.now(),
  });
  // Also update local STATE immediately
  Object.assign(STATE, updates);
}

// ── Write a crisis log entry
export async function writeCrisisLog(data) {
  if (!STATE.uid) return;
  const key = 'crisis_' + Date.now();
  await set(ref(db, 'clinics/' + STATE.uid + '/crisisLogs/' + key), {
    ...data,
    timestamp: Date.now(),
  });
}

// ── Format helpers used across pages
export function fuelLitres()  { return Math.round(STATE.fuelPct / 100 * STATE.tankLitres); }
export function runtime()     { return (fuelLitres() / (STATE.genKva * 0.25)).toFixed(1); }
export function nepaOffHours() {
  if (STATE.nepaOnline || !STATE.nepaOffStart) return 0;
  return ((Date.now() - STATE.nepaOffStart) / 3600000).toFixed(1);
}

// js/pulse-gate.js
import { STATE } from './pulse-state.js';

// Call this before showing any Pro feature.
// Returns true if the user can proceed, false if gated.
export function requiresPro(featureName, onUpgrade) {
  if (STATE.plan === 'pro' || STATE.plan === 'enterprise') return true;

  // Show upgrade prompt
  showProGate(featureName, onUpgrade);
  return false;
}

function showProGate(featureName, onUpgrade) {
  // Remove any existing gate
  document.getElementById('pro-gate-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pro-gate-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:800;
    background:rgba(2,13,8,0.88); backdrop-filter:blur(12px);
    display:flex; align-items:center; justify-content:center; padding:24px;
  `;
  overlay.innerHTML = `
    <div style="background:#0b1c15;border:1px solid rgba(0,200,100,0.22);border-radius:24px;padding:40px;max-width:420px;width:100%;text-align:center;position:relative">
      <div style="width:60px;height:60px;border-radius:50%;background:rgba(155,111,255,0.12);border:1.5px solid rgba(155,111,255,0.25);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:24px;color:#9b6fff">&#9670;</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#9b6fff;margin-bottom:8px">Pro Feature</div>
      <div style="font-size:20px;font-weight:800;color:#edfff6;margin-bottom:8px;font-family:'Syne',sans-serif">${featureName}</div>
      <div style="font-size:13px;color:#6a9e82;line-height:1.7;margin-bottom:24px">This feature is available on PULSE Pro. Upgrade to unlock unlimited AI queries, the Digital Twin, Solar Roadmap, smart switch control, and more.</div>
      <button onclick="window.location.href='pricing.html'" style="width:100%;background:#9b6fff;color:#fff;border:none;border-radius:14px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;font-family:Arial,sans-serif">View Pro Plans — from ₦20,000/month</button>
      <button onclick="document.getElementById('pro-gate-overlay').remove()" style="width:100%;background:transparent;color:#6a9e82;border:1px solid rgba(0,200,100,0.15);border-radius:14px;padding:12px;font-size:13px;cursor:pointer;font-family:Arial,sans-serif">Maybe later</button>
    </div>`;
  document.body.appendChild(overlay);
}