# Alfred MK I — Agent handoff (read this first)

**Project root:** `/Users/milton/kapiteinlabs`  
**Updated:** October 13, 2026  
**Product:** Electron + Vite + React desk assistant (“Alfred Pennyworth”), hands-free voice, Arc Reactor HUD, overlays (weather / time / calendar / system / tasks / music).

---

## Quick start

```bash
cd /Users/milton/kapiteinlabs
cp .env.example .env   # fill keys (see below)
npm install
npm run dev            # Vite :5173 + Electron
```

**Full restart required** after changing `electron/main.js` or `.env` (stop dev, run `npm run dev` again).

```bash
lsof -ti:5173 | xargs kill -9 2>/dev/null
npm run build          # sanity check
```

---

## Environment (`.env` — never commit)

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | **Primary STT (Whisper) + Primary LLM (LPUs)** via `GroqProvider`. Sub-200ms TTFB. |
| `VITE_GEMINI_API_KEY` | Secondary fallback LLM (Settings → Gemini) |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | TTS (Alfred voice). Falls back to macOS `say` if missing. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Calendar/Gmail OAuth |

**Note:** `voice_server.py` / `pyaudio` is **legacy**; live path is **browser mic → VAD → IPC `transcribe-audio` → Groq STT → Groq LLM → ElevenLabs TTS**.

---

## Directory structure

```
/Users/milton/kapiteinlabs/
├── .env.example              # Template (copy to .env)
├── package.json              # "dev" = concurrently vite + electron
├── vite.config.js
├── index.html
├── voice_server.py           # Legacy Python mic (optional; often fails without pyaudio)
├── whisper_bridge.py         # Local Whisper fallback (slow; optional)
│
├── electron/                 # Main process — IPC, STT, TTS, tools
│   ├── main.js               # ★ IPC hub: transcribe-audio, speak-text, weather, stats, chat log
│   ├── preload.js            # window.electronAPI bridge
│   ├── sttFilter.js          # STT noise/echo filter (CommonJS — must stay require/module.exports)
│   ├── elevenLabs.js         # TTS streaming
│   ├── memoryService.js      # SQLite memory + sessions
│   ├── macTools.js           # say TTS, shell tools
│   ├── taskService.js        # Local reminders/tasks
│   ├── musicService.js       # YouTube Music PWA (macOS)
│   ├── googleAuth.js         # Calendar/Gmail OAuth
│   ├── tools/
│   │   ├── weather.js        # Open-Meteo + Haarlem default / Harlem alias
│   │   ├── calendar.js
│   │   └── gmail.js
│   └── workers/
│       └── statsWorker.js    # CPU/mem/disk for HUD
│
├── src/
│   ├── main.jsx
│   ├── App.jsx               # ★ TTS queue, mic gating, startup greeting, onHeard
│   ├── audio/
│   │   └── audioBus.js       # Mic + TTS playback, Arc Reactor analyser
│   ├── hooks/
│   │   ├── useAI.js          # ★ sendMessage pipeline, intents, tools, deterministic replies
│   │   ├── useVoiceInput.js  # ★ VAD + MediaRecorder → transcribeAudio
│   │   ├── useHudDismiss.js  # Overlay dismiss on jarvis:hud-dismiss
│   │   ├── useBrowserListen.js  # Alt push-to-talk (not default path)
│   │   └── useOllama.js      # Legacy; prefer useAI
│   ├── components/
│   │   ├── JarvisHud.jsx     # ★ Main HUD shell, weather toggle, widgets
│   │   ├── ArcReactor.jsx
│   │   ├── WeatherWidget.jsx
│   │   ├── TimeCalendarWidget.jsx
│   │   ├── SystemMonitorWidget.jsx
│   │   ├── TasksWidget.jsx
│   │   ├── MusicWidget.jsx
│   │   ├── NotificationStack.jsx
│   │   ├── Settings.jsx      # userName, weatherLocation, musicAppName, provider
│   │   └── MemoryPanel.jsx
│   ├── providers/            # Gemini, OpenAI, Anthropic, Ollama
│   └── utils/
│       ├── weatherLocation.js   # ★ Session last city + Settings default + parseWeatherIntent
│       ├── scheduleIntent.js    # time/date/schedule/system/tasks/music intents
│       ├── alfredGreeting.js    # Time-of-day startup line
│       ├── systemStats.js       # HUD + speech same CPU/mem/disk numbers
│       ├── sttFilter.js         # Renderer mirror of electron/sttFilter.js
│       ├── hudOverlay.js        # focusHudOverlay → jarvis:hud-focus + dismiss
│       ├── overlayCoordinator.js
│       ├── toolParser.js
│       ├── sentenceChunker.js
│       └── notify.js            # jarvis:notify toasts
│
├── HANDOVER/
│   ├── HANDOFF_FOR_AGENT.md  # ← this file
│   ├── CONTEXT.md            # Older dossier (Oct 12) — partial; prefer this file
│   └── files/                # Snapshot copies (may be stale)
│
└── AGENT_CONTEXT.md          # Older manual (Oct 12) — update alongside HANDOFF
```

---

## Voice → reply pipeline

```
Mic (useVoiceInput VAD)
  → Blob → IPC transcribe-audio (electron/main.js)
      → Groq Whisper (if GROQ_API_KEY) — only tier when key present
      → else Gemini multimodal STT (slow / 503 prone)
  → filterSttText + renderer isSttNoise / echo guards (App.jsx onHeard)
  → useAI.sendMessage
      → Prefetch: memory, time, weather, calendar, tasks, stats, music
      → Deterministic short-circuit: pure system / time / date (no LLM paraphrase)
      → Else stream LLM + SentenceChunker → queueSentence → speak-text (ElevenLabs / say)
  → jarvis:* events → HUD widgets
```

**Mic blocked when:** `ttsPlaying || ttsSynthesizing || listenCooldown` (~900ms after TTS).  
**Not blocked during:** LLM “thinking” (user can interrupt → `pendingUtteranceRef`).

---

## Startup behavior (Oct 13)

- After chat log loads: **always speak** time-of-day greeting (`alfredGreeting.js`), **never** replay last saved assistant message.
- Settings → **Your name** → used in greeting (else “Sir”).
- Chat history may still **show** in UI; boot TTS ignores old turns.

---

## Weather location rules

- **Order:** explicit city in utterance → `sessionStorage` last successful fetch → Settings `weatherLocation` (default Haarlem, NL).
- **Follow-up** “what’s the weather?” should keep **last city**, not reset randomly.
- Backend: `electron/tools/weather.js` (Open-Meteo); `harlem` → Haarlem NL alias.

---

## Recent fixes applied (Oct 13)

- **STT False-Noise Filter Fixed**: Replaced over-restrictive single-word/punctuation and courtesy drops with targeted `SUBTITLE_HALLUCINATION_RE` in `electron/sttFilter.js` and `src/utils/sttFilter.js`. Common phrases like "Yes.", "Good morning", "Thank you", "Alfred", "Weather." now pass cleanly into STT.
- **Echo Substring False-Positive Fixed**: `isEchoOfLastSpoken` previously checked `last.includes(t)` where `last` was the entire 120-character startup greeting, erroneously killing short commands like "Sir", "Hello", "help", "tasks". Now requires >= 4 matching words or exact full-length matches.
- **Barge-in Speaker Feedback Fixed**: In `useVoiceInput.js`, VAD was triggering `onBargeIn()` whenever speaker output exceeded `0.028` RMS, cutting off Alfred's own voice mid-sentence. Added a separate loud vocal threshold (`BARGE_IN_THRESHOLD = 0.18`) during TTS playback.
- **Deterministic Weather Response**: Direct queries ("What's the weather?") now return deterministic Open-Meteo speech in sub-150ms without waiting for LLM generation.
- **ReferenceError pureSystemQuery Fixed**: Added missing `const pureSystemQuery` definition in `src/hooks/useAI.js` and wrapped the entire `sendMessage` pipeline in an outer `try/catch/finally` block so `streamState` is guaranteed to return to `'idle'` and never freeze.
- **12-Hour Clock Across All HUD Components**: Converted clock from 24-hour to 12-hour AM/PM format in `src/components/JarvisHud.jsx`, `src/components/TimeCalendarWidget.jsx`, and `electron/main.js`.
- **macOS APFS Real Storage Calculation**: Fixed `getDiskStats()` in `electron/workers/statsWorker.js`. Previously, `si.fsSize()` summed virtual APFS mount sizes sharing the same container (causing total disk space to appear as 1.2 TB and usage to report as only 18%). Updated to read `/System/Volumes/Data` directly (via `df -k /System/Volumes/Data`), correctly reporting your real 91% storage usage (185 GB used / 228 GB total).

---

## Known issues / backlog (for next agent)

**High**

- Overlay stack: only partial `jarvis:hud-dismiss` wiring (system + calendar/time; tasks/music incomplete).
- Time vs system HUD both **top-right** — can overlap.
- `get_weather` tool in main may still default Haarlem without reading Settings (unify with `weatherLocation.js`).
- Chat log load/save races; no flush on quit.
- Power save blocker 60s timeout vs long turns.

**Medium**

- ElevenLabs empty buffer → silent reply (check HUD logs `voice::tts empty buffer`).
- `chunked_data_pipe` errors = Gemini upload (should be rare if Groq-only STT).

**Dev noise (ignore)**

- React DevTools suggestion, Electron CSP warning in dev.

---

## Git state (handoff moment)

- Branch: `main` tracking `upstream` (`https://github.com/hzaid01/Jarvis.git`).
- **Many modified + untracked files** under `kapiteinlabs` — work is **local**, not necessarily pushed.
- **Do not commit `.env`** (contains secrets).

---

## Related docs

| File | Use |
|------|-----|
| `HANDOVER/HANDOFF_FOR_AGENT.md` | **Primary** — structure + current behavior |
| `HANDOVER/CONTEXT.md` | Historical bugs/fixes (Oct 12) |
| `AGENT_CONTEXT.md` | Long architecture notes (partially outdated on STT/greeting) |

---

## Test phrases

1. Launch → hear greeting with time of day, not old CPU/weather line.
2. “What’s the time?” / “What was the time?” → time HUD + spoken time.
3. “Weather in Amsterdam” → “What’s the weather?” → still Amsterdam.
4. “How is my computer performing?” → system overlay % match speech.
5. Terminal: `[STT] Heard (groq-whisper, …)` on voice input.

---

## Security reminder for handoff receiver

User may have pasted API keys in chat. **Rotate Groq/Gemini/ElevenLabs keys** if this repo or chat was shared.
