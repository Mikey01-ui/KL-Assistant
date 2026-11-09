# ALFRED MK I — HANDOVER & CONTEXT DOSSIER

**Handover Folder Location**: `/Users/milton/kapiteinlabs/HANDOVER`  
**Active Project Root**: `/Users/milton/kapiteinlabs`  
**Date**: October 12, 2026 (superseded in part by Oct 13 handoff)

> **Next agent:** use [`HANDOFF_FOR_AGENT.md`](HANDOFF_FOR_AGENT.md) + [`STRUCTURE.txt`](STRUCTURE.txt) for current architecture, STT (Groq), greeting, and known bugs.

---

## 1. Project Identity & Mission

- **Persona**: **Alfred Pennyworth** (Batman's personal butler and aide).
- **Tone**: Calm, respectful British butler composure (addresses user as *"Sir"*), concise, direct, helpful (1–2 spoken sentences). No theatrical Batman tropes, monologues, or grandiose Gotham theatrics.
- **Startup Greeting**:
  On every server/app launch, Alfred MUST speak:
  > *"Hello, good morning, sir. I'm Alfred, your personal butler, ready to help you with whatever tasks you are having or whatever you think is best."*
- **Voice Engine**: **ElevenLabs**
  - Voice ID: `HbXAfXIWqGLCJNaU3cT1` (Alfred Pennyworth)
  - Model: `eleven_turbo_v2_5`
  - Latency: ~380–420ms TTFB via direct streaming.
- **Top Bar**: `WAYNE ENTERPRISES // ALFRED MK I`

---

## 2. Root Cause Analysis: Why Voice "Didn't Respond at All"

During live testing, the system logs revealed the exact reason voice stopped responding:

### The Bug
1. **Gemini STT Subtitle Hallucination**:
   When faint background noise or room silence was sent to Google Gemini STT, Gemini frequently hallucinated YouTube subtitle timestamps such as:
   `"0:00"`, `"00"`, `"00:00"`.
2. **AI Engine Lockout**:
   The frontend `onHeard` callback received `"0:00"` and dispatched it to `ai.sendMessage("0:00")`.
3. **Microphone Lockout Loop**:
   In `src/App.jsx`:
   ```javascript
   const aiBusy = ai.streamState !== 'idle' || Boolean(ai.toolExecuting);
   const micBlocked = aiBusy || ttsPlaying || listenCooldown;
   ```
   Because `ai.sendMessage("0:00")` started processing, `micBlocked` became `true`. The AI model hung generating on `"0:00"` until the 60-second power save blocker timed out (`Power save blocker stopped (timeout 60s)`).
4. While the engine was locked for 60 seconds, **the microphone was completely blocked**, making the app appear dead and non-responsive to the user's voice.

### The Fix Implemented
1. In `electron/main.js`:
   Added a strict regex filter before returning text from Gemini STT:
   ```javascript
   const isNoise = /^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\)|thank you for watching|subtitles? by.*)$/i.test(text);
   if (text && !isNoise && /[a-zA-Z]/.test(text)) {
     return text;
   }
   ```
2. In `src/App.jsx`:
   In `onHeard`:
   ```javascript
   if (/^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\))$/i.test(cleaned)) return;
   if (!/[a-zA-Z]/.test(cleaned)) return;
   ```
   Pure timestamp noise is dropped immediately, keeping `aiBusy` idle and the microphone open and receptive at all times.
3. Extended the STT timeout from 8.5s to 12s in `electron/main.js` to prevent network jitter drops.

---

## 3. High-Accuracy Weather Engine (Haarlem, Netherlands)

- **The Problem**:
  `wttr.in` without a city name used IP geolocation, routing through the user's ISP datacenter in **Rotterdam** (17°C). When the user typed/said `"Harlem"`, it routed to **Harlem in Manhattan, New York** (24°C).
- **The Solution in `electron/tools/weather.js`**:
  1. Integrated **Open-Meteo API** (free, open-source, official national meteorological radar/model data; zero rate limits, zero hallucinations).
  2. Fixed coordinates for **Haarlem, Netherlands** (`52.3808° N, 4.6368° E`), reporting actual Dutch autumn temperatures (~14°C, Overcast).
  3. Mapped `"harlem"` (single-a) alias to `"Haarlem, Netherlands"`.
  4. Added a user-configurable **Home Weather Location** input in `Settings.jsx` (`Haarlem, Netherlands` by default).

---

## 4. Key File Map & Architecture

```
/Users/milton/kapiteinlabs/
├── HANDOVER/                               # Dedicated Handover Package
│   ├── CONTEXT.md                          # This comprehensive dossier
│   └── files/                              # Snapshot of all core modified files
│       ├── electron/
│       │   ├── main.js                     # IPC dispatch, 16kHz WAV STT transcode, noise filter
│       │   ├── elevenLabs.js               # ElevenLabs streaming client, Set controller tracking
│       │   ├── memoryService.js            # SQLite memory database, Alfred prompt coreHeader
│       │   └── tools/
│       │       └── weather.js              # Open-Meteo engine, Haarlem default & coordinates
│       └── src/
│           ├── App.jsx                     # Root component, queueSentence, barge-in, onHeard filter
│           ├── styles/jarvis-hud.css       # Clean styling, Wayne Enterprises theme
│           ├── hooks/
│           │   ├── useAI.js                # Prompt, tool parser, weather filter
│           │   └── useVoiceInput.js        # Web Audio VAD (RMS energy gating)
│           ├── components/
│           │   ├── ArcReactor.jsx          # Original clean reactor canvas & SVG
│           │   ├── JarvisHud.jsx           # HUD topbar, brand, reactor container
│           │   ├── WeatherWidget.jsx       # Typewriter transparent HUD weather card
│           │   ├── TimeCalendarWidget.jsx  # Digital clock & holographic calendar (scale 0.38)
│           │   └── Settings.jsx            # Settings modal with Home Weather Location
│           └── utils/
│               └── toolParser.js           # Tool tag parser
├── .env                                    # Voice ID: HbXAfXIWqGLCJNaU3cT1, Gemini API key
├── package.json                            # Scripts: "dev", "build"
└── AGENT_CONTEXT.md                        # Root workspace context manual
```

---

## 5. How to Run & Verify

1. **Verify Build**:
   ```bash
   npm run build
   ```
2. **Launch Dev Server**:
   ```bash
   npm run dev
   ```
3. **Kill Processes on Port 5173 / Electron**:
   ```bash
   lsof -ti:5173 | xargs kill -9 2>/dev/null
   pkill -f "electron ." 2>/dev/null
   ```
