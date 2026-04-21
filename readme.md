# PULSE — Predictive Utility & Life-Support Energy System

> **AI-powered clinical energy intelligence for Nigerian hospitals.**  
> Built for the realities of today. Designed to enable the systems of tomorrow.

---

## The Problem

At 9:57 PM in a primary health centre in Lagos, the NEPA supply cuts.  
A delivery is in progress. The generator is running low.  
The nurse has no way to know how long the fuel will last, which devices to turn off, or when the fridge temperature will become dangerous.

**40% of Nigerian primary health centres lack reliable electricity.** Hospitals run on diesel generators with no visibility into fuel levels, no structured load prioritisation, and no early warning system. Decisions are reactive, manual, and made under pressure.

Energy failure directly compromises healthcare delivery — and it happens every day.

---

## The Solution

PULSE is a **zero-hardware AI-powered clinical energy intelligence platform** that runs on any Android phone using a hospital's existing generator and NEPA infrastructure.

It gives clinical staff a real-time energy command centre:

- **Live monitoring** — generator fuel, vaccine fridge temperature, NEPA status, and total power load, all updating every 2 seconds
- **Offline triage engine** — tells staff exactly which devices to keep on, reduce, and cut during a crisis, extending generator runtime by up to 2.7 hours
- **AI Co-Pilot** — answers energy questions in English, Yoruba, Hausa, and Igbo, with full awareness of the clinic's real-time situation
- **Digital Twin** — simulates any scenario before it happens so staff can plan for surgery nights, fuel shortages, and extended outages
- **Solar Roadmap** — builds the business case for solar independence and generates ready-to-submit ministry letters
- **Smart switch integration** — connects to Sonoff/Shelly switches (₦3,500–₦8,000 each) so PULSE can automatically cut non-critical loads without human action

No hardware sensors. No installation. Deployable today.

---

## Architecture

PULSE is built on a **three-layer intelligence system** inspired by the human nervous system:

| Layer | Name | Function |
|-------|------|----------|
| 1 | **Spinal Cord** — Reflex Engine | Instant offline triage. Runs with zero internet. Fires immediately during a crisis. |
| 2 | **Brain** — Predictive Intelligence | Pattern learning. Anticipates fuel depletion and equipment failure hours in advance. |
| 3 | **Digital Twin** — Simulation Engine | Models future scenarios. Lets staff rehearse crisis decisions before they happen. |

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES Modules) |
| Backend | Firebase Realtime Database + Firebase Authentication |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) with SSE streaming |
| Voice input | Web Speech API (Chrome/Edge) |
| Smart switches | Sonoff MINI R2, Shelly 1, Tuya-protocol devices |
| Hosting | Firebase Hosting (static) |

---

## Project Structure

```
pulse/
│
├── index.html                  # Landing / marketing page
├── pulse_login.html            # Sign in page
├── pulse_onboarding.html       # New clinic registration
├── pulse_dashboard.html        # Main energy command centre
├── pulse_crisis.html           # Crisis input (4-question wizard)
├── pulse_triage.html           # Triage response — keep/reduce/cut
├── pulse_copilot.html          # AI Co-Pilot chat (Claude API)
├── pulse_twin.html             # Digital Twin scenario simulator
├── pulse_solar.html            # Solar Roadmap & ministry letters
├── pulse_settings.html         # Clinic settings & account
├── pricing.html                # Public pricing page
│
├── js/
│   ├── firebase-config.js      # Firebase project credentials (you create this)
│   ├── login.js                # Authentication logic
│   ├── pulse-dashboard.js      # Dashboard — live data, gauges, NEPA toggle
│   ├── pulse-crisis.js         # Crisis wizard — state management, Firebase write
│   ├── pulse-triage.js         # Triage engine — offline appliance prioritisation
│   ├── pulse-copilot.js        # Claude API streaming, fallback engine, voice
│   ├── pulse-digital-twin.js   # Simulation engine — setTimeout-based, no async
│   ├── pulse-solar.js          # ROI calculator, letter generator, crisis log stats
│   └── pulse-pricing.js        # Billing toggle, savings calculator, FAQ
│
└── README.md
```

---

## Firebase Database Structure

```
clinics/
  {uid}/
    clinicName         — "Adekunle Memorial Clinic"
    firstName          — "Chukwuemeka"
    lastName           — "Adeyemi"
    role               — "Medical Director"
    state              — "Lagos"
    lga                — "Alimosho"
    facilityType       — "Primary Health Centre"
    generatorKva       — 20
    tankLitres         — 200
    fuelType           — "Diesel (AGO)"
    nepaReliability    — "Very rare (0–2 hrs/day)"
    plan               — "free" | "pro" | "enterprise"
    solar              — "No — generator only"

    liveReadings/
      fuelPct          — 38
      fridgeTemp       — 4.8
      loadW            — 2840
      nepaOnline       — false
      nepaOffStart     — 1718123456789 (timestamp ms)
      protocol         — "Routine"
      updatedAt        — timestamp

    appliances/
      {key}/
        name           — "Vaccine Refrigerator"
        ward           — "Pharmacy"
        priority       — "Life-Critical"
        watts          — 80
        qty            — 1
        smart          — true

    crisisLogs/
      {timestamp}/
        situation      — "Delivery in Progress"
        fuelPct        — 38
        nepaOnline     — false
        wards          — ["Delivery Room", "Maternity Ward"]
        timestamp      — 1718123456789

    protocolLogs/
      {timestamp}/
        situation, fuelPct, nepaOnline, wards, confirmed, timestamp

    notifications/
      lastRead         — timestamp

    smartSwitchConfig/
      ac               — true
      admin            — true
      reception        — false
```

---

## How to Run Locally

### Prerequisites

- A modern browser (Chrome or Edge recommended — required for voice input on Co-Pilot)
- A free [Firebase](https://firebase.google.com) account
- A free [Anthropic](https://console.anthropic.com) account (for AI Co-Pilot)
- A local web server (see step 4 — plain `file://` will not work with ES modules)

---

### Step 1 — Clone or download the project

```bash
git clone https://github.com/your-username/pulse.git
cd pulse
```

Or download and unzip the project folder.

---

### Step 2 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it `pulse-clinic` → disable Google Analytics → **Create project**

**Enable Authentication:**
3. In the left sidebar go to **Build → Authentication → Get started**
4. Enable **Email/Password** provider
5. Enable **Google** provider (follow the prompts)
6. Go to **Settings → Authorized domains** → add `localhost`

**Enable Realtime Database:**
7. Go to **Build → Realtime Database → Create database**
8. Choose your closest region → start in **locked mode**
9. Once created, click the **Rules** tab and replace the content with:

```json
{
  "rules": {
    "clinics": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```
10. Click **Publish**

---

### Step 3 — Create `js/firebase-config.js`

In your Firebase project:
1. Go to **Project Settings** (gear icon) → **General**
2. Scroll to **Your apps** → click **Add app** → choose **Web** (`</>`)
3. Name it `pulse-web` → click **Register app**
4. Copy the config object shown

Create the file `js/firebase-config.js` in your project folder:

```javascript
// js/firebase-config.js
import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth,
         GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
```

> **Important:** Replace every `YOUR_...` value with your actual Firebase credentials from the config object. Make sure `databaseURL` is included — it is **not** in the default config snippet and you must add it manually. Find it on the Realtime Database page, it looks like `https://your-project-default-rtdb.firebaseio.com`.

---

### Step 4 — Add your Anthropic API key

Open `js/pulse-copilot.js` and find this line near the top:

```javascript
'x-api-key': window.PULSE_API_KEY || '',
```

Add this line to `pulse_copilot.html` just before the closing `</body>` tag (after your script tag):

```html
<script>
  window.PULSE_API_KEY = 'sk-ant-YOUR_KEY_HERE';
</script>
```

Get your API key from [console.anthropic.com](https://console.anthropic.com) → **API Keys**.

> **Note for production:** Never expose API keys in client-side code. For a production deployment, proxy the Claude API through a backend server or Firebase Cloud Function.

---

### Step 5 — Start a local web server

ES modules (`type="module"`) require a proper HTTP server. You cannot open the HTML files directly with `file://`.

**Option A — Python (recommended, no install needed):**
```bash
# From inside your project folder:
python3 -m http.server 8000
```
Then open: [http://localhost:8000](http://localhost:8000)

**Option B — Node.js with `serve`:**
```bash
npm install -g serve
serve .
```

**Option C — VS Code Live Server extension:**
Install the **Live Server** extension → right-click `index.html` → **Open with Live Server**

---

### Step 6 — Create your first clinic account

1. Open [http://localhost:8000/pulse_onboarding.html](http://localhost:8000/pulse_onboarding.html)
2. Fill in all steps — clinic name, location, generator size, tank capacity, and at least 5 appliances
3. This creates your Firebase account and writes your clinic profile to the database
4. You will be redirected to the dashboard automatically

---

### Step 7 — Verify it is working

Open your browser's **DevTools** (`F12`) → **Console** tab.

You should see **no red errors**. If you see:

| Error | Fix |
|-------|-----|
| `Failed to resolve module specifier "./firebase-config.js"` | Check the file exists at `js/firebase-config.js` and the path in each JS file matches |
| `permission_denied` | Your Firebase Realtime Database rules are not published — repeat step 2 rules section |
| `auth/unauthorized-domain` | Add `localhost` to Firebase → Authentication → Settings → Authorized domains |
| `X is not defined` | The external JS file failed to load — check the `src` path in the HTML `<script>` tag |
| `databaseURL` errors | Add the `databaseURL` field to your `firebase-config.js` — it is required for Realtime Database |

---

## Business Model

| Plan | Price | Target |
|------|-------|--------|
| **Free** | ₦0/month | Individual clinics — crisis triage, live dashboard, 10 AI queries/day |
| **Pro** | ₦20,000/month | Full platform — unlimited AI, Digital Twin, Solar Roadmap, smart switches |
| **Enterprise** | Custom | State ministries, NGOs, clinic chains — multi-facility dashboard, API access, white-label |

A 14-day Pro trial is included on signup. No credit card required.

---

## Impact Projections

Based on a baseline generator runtime of **2.1 hours** at 38% fuel during a delivery:

- PULSE triage extends runtime to **4.8 hours** — a **+2.7 hour** extension
- Estimated **30% reduction** in diesel spend through load optimisation
- Vaccine cold-chain monitoring prevents spoilage events that cost ₦50,000–₦200,000 per incident
- Solar Roadmap pathway: **14-month payback period** on a 20 kWp installation vs current diesel costs

---

## Submission Notes

- **All core functionality works offline** — the triage engine, crisis input, and appliance registry require no internet connection once the app is loaded
- **Firebase** handles all persistent state — every toggle, crisis log, and live reading is written to the database in real time
- **No hardware required** — PULSE works with a standard Android phone and the clinic's existing generator
- **AI is optional** — the Co-Pilot falls back to a local response engine if the Anthropic API is unavailable

---

## Built By

**ChemXAI** — Nigeria  
[hello@chemxai.com](mailto:hello@chemxai.com)

---

*PULSE — From uncertainty to intelligence. From limitation to control.*