# JARVIS — Mac AI Assistant (fork)

Local, voice-first assistant based on [hzaid01/Jarvis](https://github.com/hzaid01/Jarvis), ported for **macOS**, with **Google Calendar** and **Gmail** tools.

## Prerequisites

- macOS (primary target for this fork)
- Node.js 18+
- Python 3.9+ (optional, for Whisper voice STT)
- [Ollama](https://ollama.ai) with a local model (e.g. `ollama pull qwen2.5:3b`)
- Google Cloud OAuth Desktop client (for Calendar + Gmail)

## Quick start

```bash
cp .env.example .env
# fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

npm install
npm run dev
```

This launches Vite on `http://localhost:5173` and the Electron HUD.

### Google setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Google Calendar API** and **Gmail API**
3. Configure OAuth consent screen (External or Internal)
4. Create credentials → **OAuth client ID** → Application type **Desktop app**
5. Copy Client ID and Client Secret into `.env`
6. In the app: **Settings → Connect Google** (browser opens; tokens stay encrypted in Electron `userData`)

### Voice (optional)

Chat and macOS `say` TTS work without Python. For microphone STT:

```bash
brew install portaudio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set `PYTHON_PATH` in `.env` to `.venv/bin/python` if needed.

## What works

- Local LLM via Ollama (also OpenAI / Anthropic / Gemini providers)
- Mac system tools: open apps, files, volume, screenshots, shell, power
- Google Calendar: list / create / update / delete events
- Gmail: list / search / read / draft reply / send (send confirms)
- HUD UI, SQLite memory

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + Electron |
| `npm run build` | Production frontend build |
| `npm run electron` | Electron against `dist/` |

## Upstream

Original project: https://github.com/hzaid01/Jarvis (MIT)
