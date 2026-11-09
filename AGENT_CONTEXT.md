# ALFRED MK I — AGENT CONTEXT & HANDOVER MANUAL

**Project Root**: `/Users/milton/kapiteinlabs`  
**Generated Date**: October 12, 2026 (see **Oct 13 update** below)  
**Primary Purpose**: Autonomous hands-free desktop AI assistant featuring **Alfred Pennyworth** (Batman's butler) persona, ElevenLabs voice synthesis, real-time Web Audio Voice Activity Detection (VAD), and transparent holographic HUD animations.

> **Oct 13, 2026 — For the next agent, read first:** [`HANDOVER/HANDOFF_FOR_AGENT.md`](HANDOVER/HANDOFF_FOR_AGENT.md) and [`HANDOVER/STRUCTURE.txt`](HANDOVER/STRUCTURE.txt).  
> STT is **Groq Whisper** when `GROQ_API_KEY` is set (not Gemini-first). Startup greeting is **time-of-day** via `alfredGreeting.js`, not a fixed “good morning” line. Weather uses `src/utils/weatherLocation.js` (session last city + Settings).

---

## 1. Executive Summary & Requirements

1. **Persona**: **Alfred Pennyworth** — Loyal, calm, highly capable personal butler and aide to "Sir". Polite, respectful, direct, and concise (1–2 punchy spoken sentences maximum). Does NOT over-exaggerate theatrical Batman tropes or monologue; directly answers and executes what Sir needs.
2. **Startup Greeting**:
   Every time the server/app starts, Alfred MUST speak:
   > *"Hello, good morning, sir. I'm Alfred, your personal butler, ready to help you with whatever tasks you are having or whatever you think is best."*
3. **Voice Synthesis**:
   - Provider: **ElevenLabs**
   - Voice ID: `HbXAfXIWqGLCJNaU3cT1` (Alfred voice configured in `.env`)
   - Latency: ~380–450ms TTFB via direct MP3 stream.
4. **Speech-to-Text (STT)**:
   - Engine: Browser Web Audio VAD detects speech RMS -> dispatches audio buffer over Electron IPC -> Electron transcodes to 16kHz mono WAV via in-memory ffmpeg -> Google Gemini (`gemini-flash-lite-latest`) STT.
   - Latency: ~1.1s transcription time.
5. **Arc Reactor Orb**:
   - Original clean, elegant Wayne Enterprises arc reactor canvas and SVG rings with audio-reactive waveforms (responsive to TTS and mic levels). Supports smooth corner flight (`scale(0.38)`) during holographic calendar view.
6. **HUD Animations**:
   - **Time Query** (*"What's the time?"*): Top-right transparent digital clock readout, auto-dismisses after speech completes.
   - **Weather Query** (*"What's the weather?"*): Transparent typewriter HUD widget displaying city, temp, condition, high/low, auto-dismisses after speech completes. Handled in **a single pass** (no duplicate tool summarization calls).
   - **Date Query** (*"What's the date?"*): Arc Reactor orb smoothly flies to the bottom-left corner (`scale(0.38)`), revealing a holographic interactive calendar with a pulsating indicator on today's date. On speech completion, the orb glides back to center.

---

## 2. File Map & Critical Architecture

### Environment Configuration
- [`.env`](file:///Users/milton/kapiteinlabs/.env): Contains `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID=HbXAfXIWqGLCJNaU3cT1`, `ELEVENLABS_MODEL_ID=eleven_turbo_v2_5`, and `VITE_GEMINI_API_KEY`.

### Frontend (`src/`)
- [`src/App.jsx`](file:///Users/milton/kapiteinlabs/src/App.jsx):
  - Application root component.
  - Manages `sentenceQueueRef` and `drainSentenceQueue` with sentence-ahead pre-fetching.
  - Enqueues Alfred's exact startup greeting on mount (`useEffect` around line 160).
  - Handles barge-in interrupts (ESC key or user speech triggers `stopTTS` & `ai.stopGeneration`).
  - Wireup for `onTapMic` toggle between autonomous listening and paused state.
- [`src/hooks/useAI.js`](file:///Users/milton/kapiteinlabs/src/hooks/useAI.js):
  - Core AI orchestration hook.
  - `FALLBACK_PROMPT`: Alfred Pennyworth British butler instructions.
  - Parallel pre-fetch of system time, memory prompt, and weather data (`window.electronAPI.getWeather`).
  - Dispatches custom browser events: `jarvis:weather`, `jarvis:time`, and `jarvis:date`.
  - Filters out redundant `get_weather` tool execution when live weather data was already provided in the system prompt context (prevents double-speaking the temperature).
- [`src/hooks/useVoiceInput.js`](file:///Users/milton/kapiteinlabs/src/hooks/useVoiceInput.js):
  - Autonomous hands-free speech detector.
  - Real-time VAD inspecting RMS audio energy every 40ms.
  - `SPEECH_THRESHOLD = 0.028`, `MIN_SPEECH_DURATION = 240ms`, `SILENCE_TIMEOUT = 360ms`.
  - Dispatches recorded WebM chunks to `window.electronAPI.transcribeAudio`.
- [`src/audio/audioBus.js`](file:///Users/milton/kapiteinlabs/src/audio/audioBus.js):
  - Singleton `AudioContext` with analyser nodes wired to the reactive Arc Reactor canvas.
  - `playTtsBuffer(arrayBuffer, onEnded)` decodes MP3/WAV ArrayBuffers directly in Web Audio without leaking DOM audio elements.
- [`src/components/JarvisHud.jsx`](file:///Users/milton/kapiteinlabs/src/components/JarvisHud.jsx):
  - HUD interface with Wayne Enterprises branding (`WAYNE ENTERPRISES // ALFRED MK I`).
  - Contains Arc Reactor center container, HUD panels, and button controls.
- [`src/components/ArcReactor.jsx`](file:///Users/milton/kapiteinlabs/src/components/ArcReactor.jsx):
  - Canvas reactor orb rendering rotating tick rings, core pulsation, and frequency wave rings.
  - Supports `cornerMode` prop (glides to bottom-left corner with `scale(0.38)` during calendar mode).
- [`src/components/WeatherWidget.jsx`](file:///Users/milton/kapiteinlabs/src/components/WeatherWidget.jsx):
  - Pure transparent typewriter HUD weather widget. Listens for `jarvis:tts-finished` to auto-dismiss after speech.
- [`src/components/TimeCalendarWidget.jsx`](file:///Users/milton/kapiteinlabs/src/components/TimeCalendarWidget.jsx):
  - Handles time-only digital readout and interactive monthly calendar display.
- [`src/utils/toolParser.js`](file:///Users/milton/kapiteinlabs/src/utils/toolParser.js):
  - Regex parser for `<<<TOOL:name|params>>>`.
  - `getToolSystemPrompt({ excludeWeather })`: Generates tool schema; omits weather examples when weather data is already injected.

### Electron Backend (`electron/`)
- [`electron/main.js`](file:///Users/milton/kapiteinlabs/electron/main.js):
  - Electron main process and IPC dispatch.
  - `transcribe-audio`: Uses `convertTo16kWav` (in-memory ffmpeg pipe at `/opt/homebrew/bin/ffmpeg`) to convert WebM into 16kHz mono WAV in ~50ms, then queries `gemini-flash-lite-latest` via canonical `inlineData` schema.
  - `speak-text`: Dispatches text to `elevenLabs.speak()`, falling back to macOS `say` if unconfigured.
  - `get-weather`: Queries `electron/tools/weather.js`.
- [`electron/elevenLabs.js`](file:///Users/milton/kapiteinlabs/electron/elevenLabs.js):
  - ElevenLabs streaming client.
  - Uses `Set` of active controllers (`activeControllers`) so ahead-of-time sentence pre-fetching never aborts currently playing speech mid-sentence.
- [`electron/memoryService.js`](file:///Users/milton/kapiteinlabs/electron/memoryService.js):
  - SQLite persistent memory database (`memory.db`).
  - Sets Alfred persona in `coreHeader`.
- [`electron/tools/weather.js`](file:///Users/milton/kapiteinlabs/electron/tools/weather.js):
  - High-precision dual-engine weather service.
  - Primary: **Open-Meteo API** (official national meteorological radar data, zero rate-limits, zero hallucinations).
  - Fallback: `wttr.in`.
  - Default Location: `Haarlem, Netherlands` (exact coordinates: 52.3808° N, 4.6368° E).
  - Maps common English spelling `Harlem` automatically to `Haarlem, Netherlands` to prevent accidental New York routing.
  - Configurable via `Settings -> Home Weather Location`.

---

## 3. Important Resolved Bugs & Key Takeaways

1. **STT Dropped Audio / Freezes**:
   - *Problem*: Electron backend had a 3500ms timeout and ran sequential fallback loops across models when Gemini took longer on compressed WebM audio.
   - *Fix*: Transcode WebM to 16kHz mono WAV via in-memory ffmpeg pipe in ~50ms before calling Gemini. Gemini processes 16kHz WAV in ~1.1s without timeouts. Increased timeout to 8500ms.
2. **Weather Hallucination & Rotterdam/NY Inaccuracy**:
   - *Problem*: The app previously queried `wttr.in/?format=j1` without a location when asked "what is the weather". IP geolocation routed through the ISP's proxy datacenter in Rotterdam/Harderwijk (17°C). Furthermore, when the user said "Harlem", it routed to Harlem, Manhattan, New York (24°C)!
   - *Fix*: Integrated **Open-Meteo API** as primary engine with exact coordinates for **Haarlem, Netherlands** (14°C, overcast), mapped `Harlem` alias to `Haarlem, Netherlands`, and added a dedicated user-editable `Home Weather Location` field in Settings.
3. **Weather Repeated Twice & High Latency**:
   - *Problem*: Weather was pre-fetched and injected into the prompt, but tool examples in `toolParser.js` caused Gemini to emit `<<<TOOL:get_weather>>>`. `useAI.js` treated this as a query tool and executed a second LLM turn to summarize results, speaking the temperature twice.
   - *Fix*: Exclude weather tool examples from prompt when conditions are already known, and filter `get_weather` out of `effectiveTools` in `useAI.js`. Weather now speaks instantly in 1 turn.
4. **ElevenLabs Pre-fetch Aborting Active Speech**:
   - *Problem*: Pre-fetching sentence 2 previously cleared the global AbortController, killing sentence 1.
   - *Fix*: Converted `activeControllers` and `activeRequests` to `Set` instances. Only explicit user interrupts (`stopSpeaking()`, ESC, barge-in) abort speech.

---

## 4. Run & Test Commands

- **Install dependencies**: `npm install`
- **Development build & run**: `npm run dev`
  - Starts Vite on `http://localhost:5173` and boots Electron.
- **Production bundle check**: `npm run build`
  - Runs `vite build` (must finish with 0 errors).
- **Kill lingering dev servers**:
  ```bash
  lsof -ti:5173 | xargs kill -9 2>/dev/null
  pkill -f "electron ." 2>/dev/null
  ```
