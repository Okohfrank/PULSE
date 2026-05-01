import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { ref, set } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentStep = 1;
let currentAppStep = 1;
let wardCount = 4;
let applianceIdCounter = 7;
let applianceData = [
{id:1, name:'Vaccine Refrigerator', model:'Haier HBC-40', ward:'Pharmacy', priority:'Life-Critical', smart:true, qty:1, watts:80},
{id:2, name:'Oxygen Concentrator', model:'Philips EverFlo 5L', ward:'Delivery Room', priority:'Life-Critical', smart:false, qty:2, watts:300},
{id:3, name:'Air Conditioning Unit', model:'1.5 HP Split Unit', ward:'Staff Room', priority:'Standard', smart:true, qty:1, watts:1100},
{id:4, name:'Fetal Heart Monitor', model:'Edan F6', ward:'Delivery Room', priority:'Life-Critical', smart:false, qty:1, watts:15},
{id:5, name:'Surgical Theatre Lights', model:'LED Shadowless', ward:'Operating Theatre',priority:'Life-Critical', smart:false, qty:3, watts:100},
{id:6, name:'Ward Lighting', model:'40W Fluorescent', ward:'General Ward', priority:'Important', smart:false, qty:12, watts:40}
];

// ─────────────────────────────────────────────
// SIGNUP STEPPER
// ─────────────────────────────────────────────
window.goStep = function(n) {
if (n > currentStep && !validateStep(currentStep)) return;

document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
document.getElementById('step-' + n).classList.add('active');

for (let i = 1; i <= 4; i++) {
const s = document.getElementById('ms' + i);
s.classList.remove('active', 'done');
if (i < n) s.classList.add('done');
if (i === n) s.classList.add('active');
}
currentStep = n;
window.scrollTo({ top: document.getElementById('signup-section').offsetTop - 80, behavior: 'smooth' });
if (n === 4) buildReview();
};

function validateStep(n) {
let ok = true;
if (n === 1) {
ok = requireField('fn','fn-err') & requireField('ln','ln-err') &
requireEmail('email','email-err') & requirePw() &
requireField('role','role-err') &
requireCheck('tos-check');
}
if (n === 2) {
ok = requireField('clinic-name','cn-err') &
requireSelect('state','state-err') &
requireSelect('lga','lga-err') &
requireRadio('ftype-group','ftype-err');
}
if (n === 3) {
ok = requireField('gen-kva','gkva-err') &
requireField('tank-size','tank-err') &
requireRadio('fuel-group','fuel-err');
}
return ok;
}

function requireField(id, errId) {
const el = document.getElementById(id);
const err = document.getElementById(errId);
if (!el || !el.value.trim()) {
el && el.classList.add('err');
err && err.classList.add('show');
return false;
}
el.classList.remove('err');
err && err.classList.remove('show');
return true;
}

function requireEmail(id, errId) {
const el = document.getElementById(id);
const err = document.getElementById(errId);
const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el ? el.value : '');
if (!valid) { el && el.classList.add('err'); err && err.classList.add('show'); return false; }
el && el.classList.remove('err');
err && err.classList.remove('show');
return true;
}

function requirePw() {
const pw = document.getElementById('pw');
const cpw = document.getElementById('cpw');
const pwe = document.getElementById('pw-err');
const cpwe = document.getElementById('cpw-err');
let ok = true;
if (!pw || pw.value.length < 8) {
pw && pw.classList.add('err');
pwe && pwe.classList.add('show');
ok = false;
} else {
pw.classList.remove('err');
pwe && pwe.classList.remove('show');
}
if (!cpw || !pw || pw.value !== cpw.value) {
cpw && cpw.classList.add('err');
cpwe && cpwe.classList.add('show');
ok = false;
} else {
cpw && cpw.classList.remove('err');
cpwe && cpwe.classList.remove('show');
}
return ok;
}

function requireSelect(id, errId) {
const el = document.getElementById(id);
const err = document.getElementById(errId);
if (!el || !el.value) { el && el.classList.add('err'); err && err.classList.add('show'); return false; }
el.classList.remove('err');
err && err.classList.remove('show');
return true;
}

function requireRadio(groupId, errId) {
const group = document.getElementById(groupId);
const err = document.getElementById(errId);
if (!group) return true;
const sel = group.querySelector('.radio-pill.selected');
if (!sel) { err && err.classList.add('show'); return false; }
err && err.classList.remove('show');
return true;
}

function requireCheck(id) {
const el = document.getElementById(id);
return el ? el.classList.contains('checked') : false;
}

// ─────────────────────────────────────────────
// FORM HELPERS
// ─────────────────────────────────────────────
window.togglePw = function(inputId, labelId) {
const inp = document.getElementById(inputId);
const lbl = document.getElementById(labelId);
if (!inp || !lbl) return;
if (inp.type === 'password') { inp.type = 'text'; lbl.textContent = 'hide'; }
else { inp.type = 'password'; lbl.textContent = 'show'; }
};

window.checkPwStrength = function() {
const pw = document.getElementById('pw');
const wrap = document.getElementById('pw-str');
const lbl = document.getElementById('ps-lbl');
if (!pw) return;
const segs = ['ps1','ps2','ps3','ps4'].map(id => document.getElementById(id));
if (!pw.value) { if (wrap) wrap.style.display = 'none'; return; }
if (wrap) wrap.style.display = 'block';
segs.forEach(s => s && (s.className = 'pw-seg'));
let strength = 0;
if (pw.value.length >= 8) strength++;
if (/[A-Z]/.test(pw.value)) strength++;
if (/[0-9]/.test(pw.value)) strength++;
if (/[^A-Za-z0-9]/.test(pw.value)) strength++;
const classes = ['seg-weak','seg-fair','seg-good','seg-strong'];
const labels = ['Weak','Fair','Good','Strong'];
for (let i = 0; i < strength; i++) {
segs[i] && segs[i].classList.add(classes[Math.min(strength - 1, 3)]);
}
if (lbl) lbl.textContent = labels[strength - 1] || '';
};

window.selectRadio = function(el, groupId) {
const group = document.getElementById(groupId);
if (!group) return;
group.querySelectorAll('.radio-pill').forEach(p => p.classList.remove('selected'));
el.classList.add('selected');
};

window.toggleCheck = function(id) {
const el = document.getElementById(id);
if (el) el.classList.toggle('checked');
};

window.adjustWard = function(delta) {
wardCount = Math.max(1, Math.min(50, wardCount + delta));
const el = document.getElementById('ward-count');
if (el) el.textContent = wardCount;
};

// ─────────────────────────────────────────────
// LGA DATA
// ─────────────────────────────────────────────
const LGA_DATA = {
'Lagos':['Agege','Ajeromi-Ifelodun','Alimosho','Amuwo-Odofin','Apapa','Badagry','Epe','Eti-Osa','Ibeju-Lekki','Ifako-Ijaiye','Ikeja','Ikorodu','Kosofe','Lagos Island','Lagos Mainland','Mushin','Ojo','Oshodi-Isolo','Shomolu','Surulere'],
'Kano':['Dala','Fagge','Gwale','Kano Municipal','Kumbotso','Nassarawa','Tarauni','Ungogo','Kura','Bichi'],
'Rivers':['Port Harcourt','Obio-Akpor','Ikwerre','Eleme','Emohua','Khana','Ogba-Egbema-Ndoni','Tai','Gokana','Ahoada West'],
'Oyo':['Ibadan North','Ibadan South-East','Ibadan South-West','Akinyele','Egbeda','Lagelu','Oluyole','Ona-Ara','Afijio','Atisbo'],
'FCT':['Abaji','Abuja Municipal','Bwari','Gwagwalada','Kuje','Kwali'],
'Enugu':['Enugu North','Enugu South','Igbo-Eze North','Igbo-Eze South','Isi-Uzo','Nkanu East','Nkanu West','Nsukka','Oji River','Udenu'],
'Anambra':['Awka North','Awka South','Idemili North','Idemili South','Onitsha North','Onitsha South','Nnewi North','Nnewi South','Ekwusigo','Ogbaru'],
'Edo':['Benin','Egor','Ikpoba-Okha','Orhionmwon','Ovia North-East','Ovia South-West','Owan East','Owan West','Akoko-Edo','Uhunmwonde'],
'Delta':['Asaba','Ughelli North','Ughelli South','Warri North','Warri South','Warri South-West','Ethiope East','Ethiope West','Okpe','Sapele'],
'Imo':['Owerri Municipal','Owerri North','Owerri West','Aboh Mbaise','Ahiazu Mbaise','Ehime Mbano','Ihitte-Uboma','Ikeduru','Isiala Mbano','Mbaitoli'],
};

window.populateLGA = function() {
const state = document.getElementById('state');
const lga = document.getElementById('lga');
if (!state || !lga) return;
lga.innerHTML = '<option value="" disabled selected>Select LGA</option>';
const list = LGA_DATA[state.value] || [];
list.forEach(l => {
const o = document.createElement('option');
o.textContent = l;
lga.appendChild(o);
});
};

// ─────────────────────────────────────────────
// REVIEW BUILDER
// ─────────────────────────────────────────────
function buildReview() {
const get = id => document.getElementById(id)?.value || '—';
const data = [
{ label: 'Name', value: get('fn') + ' ' + get('ln') },
{ label: 'Email', value: get('email') },
{ label: 'Role', value: get('role') },
{ label: 'Clinic', value: get('clinic-name') },
{ label: 'Location', value: [get('lga'), get('state')].filter(v => v !== '—').join(', ') || '—' },
{ label: 'Generator', value: get('gen-kva') + ' kVA' },
{ label: 'Tank', value: get('tank-size') + ' litres' },
{ label: 'Wards', value: wardCount + ' departments' },
];
const container = document.getElementById('review-content');
if (!container) return;
container.innerHTML = data.map(d => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);">
<span style="font-size:10px;color:var(--mid);letter-spacing:0.08em;text-transform:uppercase">${d.label}</span>
<span style="font-size:13px;font-family:var(--font-h);font-weight:600;color:var(--white)">${d.value}</span>
</div>`).join('');
}

// ─────────────────────────────────────────────
// ACCOUNT CREATION — Firebase
// ─────────────────────────────────────────────
window.createAccount = async function() {
// Step 4 confirm-check validation
const confirmCheck = document.getElementById('confirm-check');
if (!confirmCheck || !confirmCheck.classList.contains('checked')) {
showToast('Please confirm your details are correct', 'error');
return;
}

const btn = document.getElementById('create-btn');
if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }

// Collect all values
const email = document.getElementById('email')?.value.trim();
const password = document.getElementById('pw')?.value;
const firstName = document.getElementById('fn')?.value.trim();
const lastName = document.getElementById('ln')?.value.trim();
const role = document.getElementById('role')?.value;
const clinicName= document.getElementById('clinic-name')?.value.trim();
const state = document.getElementById('state')?.value || '';
const lga = document.getElementById('lga')?.value || '';
const genKva = document.getElementById('gen-kva')?.value || '0';
const tankSize = document.getElementById('tank-size')?.value || '0';

// Get selected radio values
const ftypeEl = document.querySelector('#ftype-group .radio-pill.selected input');
const fuelEl = document.querySelector('#fuel-group .radio-pill.selected input');
const nepaEl = document.querySelector('#nepa-group .radio-pill.selected input');
const switchEl = document.querySelector('#switch-group .radio-pill.selected input');

try {
// 1. Create user in Firebase Auth
const userCredential = await createUserWithEmailAndPassword(auth, email, password);
const uid = userCredential.user.uid;

// 2. Save clinic profile to Realtime Database
await set(ref(db, 'clinics/' + uid), {
firstName,
lastName,
email,
role: role || '',
clinicName,
state,
lga,
generatorKva: parseFloat(genKva) || 0,
tankLitres: parseFloat(tankSize) || 0,
fuelType: fuelEl ? fuelEl.value : '',
facilityType: ftypeEl ? ftypeEl.value : '',
nepaReliability: nepaEl ? nepaEl.value : '',
smartSwitches: switchEl ? switchEl.value : '',
wards: wardCount,
plan: 'free',
createdAt: Date.now(),
});

// 3. Success — show appliance section
if (btn) btn.textContent = 'Account created';
showToast('Account created successfully', 'success');

setTimeout(() => {
const signupSection = document.getElementById('signup-section');
const sectionBreak = document.getElementById('section-break');
const applianceSection = document.getElementById('appliance-section');

if (signupSection) signupSection.style.display = 'none';
if (sectionBreak) sectionBreak.classList.add('visible');

setTimeout(() => {
if (applianceSection) applianceSection.classList.add('visible');
window.scrollTo({ top: document.getElementById('section-break')?.offsetTop - 80 || 0, behavior: 'smooth' });
}, 300);
}, 700);

} catch (err) {
if (btn) { btn.disabled = false; btn.textContent = 'Create Account & Continue'; }

const messages = {
'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
'auth/weak-password': 'Password must be at least 6 characters.',
'auth/invalid-email': 'Please enter a valid email address.',
'auth/network-request-failed': 'Network error. Check your internet connection.',
};
showToast(messages[err.code] || 'Error: ' + err.message, 'error');
}
};

// ─────────────────────────────────────────────
// APPLIANCE MANAGEMENT
// ─────────────────────────────────────────────
window.openInlineForm = function() {
document.getElementById('inline-form')?.classList.add('open');
document.getElementById('add-btn').style.display = 'none';
document.getElementById('a-name')?.focus();
};

window.closeInlineForm = function() {
document.getElementById('inline-form')?.classList.remove('open');
const addBtn = document.getElementById('add-btn');
if (addBtn) addBtn.style.display = 'flex';
clearInlineForm();
};

function clearInlineForm() {
['a-name','a-model','a-watts'].forEach(id => {
const el = document.getElementById(id);
if (el) el.value = '';
});
const qty = document.getElementById('a-qty');
if (qty) qty.value = '1';
const ward = document.getElementById('a-ward');
if (ward) ward.value = '';
['apriority-group','aswitch-group'].forEach(g => {
document.getElementById(g)?.querySelectorAll('.radio-pill').forEach(p => p.classList.remove('selected'));
});
}

window.addAppliance = function() {
const nameEl = document.getElementById('a-name');
const wardEl = document.getElementById('a-ward');
const priorityEl = document.getElementById('apriority-group')?.querySelector('.selected');
const err1 = document.getElementById('aname-err');
const err2 = document.getElementById('award-err');
const err3 = document.getElementById('aprio-err');

let ok = true;
if (!nameEl?.value.trim()) {
nameEl?.classList.add('err'); err1?.classList.add('show'); ok = false;
} else {
nameEl?.classList.remove('err'); err1?.classList.remove('show');
}
if (!wardEl?.value) {
wardEl?.classList.add('err'); err2?.classList.add('show'); ok = false;
} else {
wardEl?.classList.remove('err'); err2?.classList.remove('show');
}
if (!priorityEl) {
err3?.classList.add('show'); ok = false;
} else {
err3?.classList.remove('show');
}
if (!ok) return;

const name = nameEl.value.trim();
const ward = wardEl.value;
const model = document.getElementById('a-model')?.value.trim() || '';
const watts = parseInt(document.getElementById('a-watts')?.value) || null;
const qty = parseInt(document.getElementById('a-qty')?.value) || 1;
const priority = priorityEl.querySelector('input')?.value || 'Standard';
const smartEl = document.getElementById('aswitch-group')?.querySelector('.selected');
const smart = smartEl ? smartEl.querySelector('input')?.value === 'Yes' : false;
const id = applianceIdCounter++;

const item = { id, name, model, ward, priority, smart, qty, watts };
applianceData.push(item);
renderApplianceItem(item);
updateApplianceCount();
window.closeInlineForm();
showToast(name + ' added', 'success');
};

function renderApplianceItem(item) {
const list = document.getElementById('app-list');
if (!list) return;
const abbr = item.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
const bCls = item.priority === 'Life-Critical' ? 'b-crit' : item.priority === 'Important' ? 'b-imp' : 'b-std';
const div = document.createElement('div');
div.className = 'app-item';
div.dataset.id = item.id;
div.innerHTML = `
<div class="app-item-icon">${abbr}</div>
<div class="app-item-info">
<div class="app-item-name">${item.name}</div>
<div class="app-item-meta">${item.model || 'No model'} &middot; ${item.ward} &middot; x${item.qty}</div>
<div class="app-item-badges">
<span class="badge ${bCls}">${item.priority}</span>
${item.smart ? '<span class="badge b-smart">Smart Switch</span>' : ''}
</div>
</div>
<div class="app-item-actions">
<button class="btn-icon del" onclick="removeAppliance(${item.id})" title="Remove">&#215;</button>
</div>`;
list.appendChild(div);
}

window.removeAppliance = function(id) {
applianceData = applianceData.filter(a => a.id !== id);
const el = document.querySelector(`.app-item[data-id="${id}"]`);
if (el) {
el.style.opacity = '0';
el.style.transform = 'translateX(16px)';
el.style.transition = 'all 0.25s ease';
setTimeout(() => el.remove(), 260);
}
updateApplianceCount();
};

function updateApplianceCount() {
const el = document.getElementById('appliance-count');
if (el) el.textContent = applianceData.length + ' appliance' + (applianceData.length !== 1 ? 's' : '') + ' registered';
}

// ─────────────────────────────────────────────
// APPLIANCE SUB-STEPPER
// ─────────────────────────────────────────────
window.goAppStep = function(n) {
document.querySelectorAll('.app-panel').forEach(p => p.classList.remove('active'));
document.getElementById('ap-' + n)?.classList.add('active');
for (let i = 1; i <= 4; i++) {
const s = document.getElementById('as' + i);
if (!s) continue;
s.classList.remove('active', 'done');
if (i < n) s.classList.add('done');
if (i === n) s.classList.add('active');
}
currentAppStep = n;
window.scrollTo({ top: document.getElementById('appliance-section')?.offsetTop - 80 || 0, behavior: 'smooth' });
};

// ─────────────────────────────────────────────
// AI ANALYSIS
// ─────────────────────────────────────────────
const WATTAGE_DB = {
'vaccine refrigerator': 80, 'oxygen concentrator': 300, 'air conditioning': 1100,
'fetal heart monitor': 15, 'surgical theatre lights': 100, 'ward lighting': 40,
'incubator': 250, 'suction machine': 250, 'autoclave': 2000, 'ultrasound': 300,
'ecg machine': 80, 'blood pressure monitor': 5, 'centrifuge': 200,
'microscope': 40, 'computer': 200, 'fan': 75, 'tv': 120, 'phone charger': 10,
};

function guessWatts(name) {
const n = name.toLowerCase();
for (const [key, val] of Object.entries(WATTAGE_DB)) {
if (n.includes(key.split(' ')[0])) return val;
}
return Math.floor(Math.random() * 200) + 50;
}

const AI_MESSAGES = [
'Identifying appliance specifications...',
'Looking up power ratings in medical device database...',
'Calculating load profiles for each priority tier...',
'Estimating runtime at full and critical load...',
'Building your clinic energy baseline...',
'Analysis complete',
];

window.runAIAnalysis = function() {
if (applianceData.length === 0) { showToast('Please add at least one appliance first', 'error'); return; }
window.goAppStep(2);

let msgIdx = 0;
const loadingText = document.getElementById('ai-loading-text');
const msgTimer = setInterval(() => {
if (msgIdx < AI_MESSAGES.length - 1) {
msgIdx++;
if (loadingText) loadingText.textContent = AI_MESSAGES[msgIdx];
} else {
clearInterval(msgTimer);
}
}, 700);

setTimeout(() => {
clearInterval(msgTimer);
const loading = document.getElementById('ai-loading');
if (loading) loading.style.display = 'none';
renderAIResults();
}, 4200);
};

function renderAIResults() {
const results = document.getElementById('ai-results');
const summary = document.getElementById('ai-summary');
if (!results) return;

let totalW = 0, critW = 0;
results.innerHTML = '';

applianceData.forEach(item => {
const w = item.watts || guessWatts(item.name);
item.watts = w;
const total = w * item.qty;
totalW += total;
if (item.priority === 'Life-Critical') critW += total;

const detail = item.priority === 'Life-Critical'
? 'Classified as life-critical — will never be cut during energy triage.'
: item.priority === 'Important'
? 'Important equipment — will be reduced but not cut during triage.'
: 'Standard load — can be automatically cut during a power crisis.';

const div = document.createElement('div');
div.className = 'ai-result-item';
div.innerHTML = `
<div class="air-left">
<div class="air-name">${item.name}</div>
<div class="air-detail">${item.ward} &middot; x${item.qty} &middot; ${detail}</div>
</div>
<div class="air-right">
<div class="air-watts">${total}W</div>
<div class="air-unit">${item.qty > 1 ? item.qty + ' x ' + w + 'W' : 'per unit'}</div>
</div>`;
results.appendChild(div);
});

const genKva = parseInt(document.getElementById('gen-kva')?.value) || 20;
const tankL = parseInt(document.getElementById('tank-size')?.value) || 200;
const fuelPerHour = genKva * 0.25;
const runtime = (tankL / fuelPerHour).toFixed(1);

const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
setEl('ais-total', totalW + 'W');
setEl('ais-critical', critW + 'W');
setEl('ais-runtime', runtime + 'h');
setEl('profile-total', totalW + 'W');
setEl('profile-critical', critW + 'W');
setEl('profile-runtime', runtime + ' hrs');

if (results) results.style.display = 'flex';
if (summary) summary.style.display = 'grid';
const nextBtn = document.getElementById('ai-next-btn');
if (nextBtn) nextBtn.style.display = 'flex';

buildProfileReview();
}

function buildProfileReview() {
const container = document.getElementById('profile-review');
if (!container) return;
container.innerHTML = '';
applianceData.forEach(item => {
const bCls = item.priority === 'Life-Critical' ? 'b-crit' : item.priority === 'Important' ? 'b-imp' : 'b-std';
const abbr = item.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
const div = document.createElement('div');
div.className = 'app-item';
div.style.background = 'var(--surface)';
div.innerHTML = `
<div class="app-item-icon">${abbr}</div>
<div class="app-item-info">
<div class="app-item-name">${item.name}</div>
<div class="app-item-meta">${item.ward} &middot; ${item.watts}W &middot; x${item.qty} = ${item.watts * item.qty}W total</div>
<div class="app-item-badges">
<span class="badge ${bCls}">${item.priority}</span>
${item.smart ? '<span class="badge b-smart">Smart Switch</span>' : ''}
</div>
</div>`;
container.appendChild(div);
});
}

// ─────────────────────────────────────────────
// FINISH SETUP — Save appliances to Firebase then go to dashboard
// ─────────────────────────────────────────────
window.finishSetup = async function() {
window.goAppStep(4);
showToast('Setup complete. Welcome to PULSE.', 'success');

try {
const uid = auth.currentUser?.uid;
if (!uid) {
// Not logged in — go back to login
setTimeout(() => { window.location.href = 'login.html'; }, 1500);
return;
}

// Save each appliance under clinics/{uid}/appliances/{key}
for (const appliance of applianceData) {
const key = 'app_' + appliance.id + '_' + Date.now();
await set(ref(db, 'clinics/' + uid + '/appliances/' + key), {
name: appliance.name,
model: appliance.model || '',
watts: appliance.watts || 0,
ward: appliance.ward,
priority: appliance.priority,
smart: appliance.smart,
qty: appliance.qty || 1,
savedAt: Date.now(),
});
}

// Navigate to dashboard after short delay so the success screen is visible
setTimeout(() => {
window.location.href = 'pulse-dashboard.html';
}, 2000);

} catch (err) {
console.error('Error saving appliances:', err.message);
// Still navigate even if save fails — data can be re-entered in Settings
setTimeout(() => {
window.location.href = 'pulse-dashboard.html';
}, 2000);
}
};

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────
function showToast(msg, type = 'info') {
const t = document.getElementById('toast');
const m = document.getElementById('toast-msg');
if (!t || !m) return;
t.className = 'toast ' + type;
m.textContent = msg;
t.classList.add('show');
setTimeout(() => t.classList.remove('show'), 3200);
}
