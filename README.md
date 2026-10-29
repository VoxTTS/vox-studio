# VoxTTS Studio · local edition

A simplified [voxtts.app](https://voxtts.app) that runs on your own computer at **http://localhost:3000**. It talks to the VoxTTS API with your key and can also download and run open-source TTS and STT models from Hugging Face, with ModelScope as a mirror.

| Area | What it does |
| --- | --- |
| **Playground · Speech** | Text to speech on all eight VoxTTS models (Vox 2, Flash, 2.5, 3 Studio, 3 Express, 3.1, 3.5, 4) or on a local model. Covers voice, style direction, speed, delivery and language. Long text is split by sentence and joined. Tags like `<laugh>` and `<short pause>` are translated to each model's syntax. |
| **Playground · Podcast** | Multi-speaker dialogue on Vox 3 (up to 4 speakers, 24 lines): paste a `Name: text` script, run **Auto-direct** (adds tags and style notes for free), and turn on optional overlapping reactions. |
| **Playground · Audiobook** | Whole manuscripts (up to 100k characters) rendered in the background on voxtts.app, with optional "magic" casting and chapter direction. Shows progress, lets you stop and resume, and saves MP3, M4B or ZIP to the Library. |
| **Playground · Transcribe** | Speech to text with `vox-stt-1` (word timestamps, diarization, voice profile) or a local Whisper. Export as .txt or .srt. |
| **Voices** | The catalogue for each model family, including your designed and cloned voices. Previews cost about 50 characters once and are cached after that. You can also **design a voice**, then rename or delete it. |
| **Library** | Every result is stored on disk, with search, filters, rename, download and move-to-project. |
| **Projects** | Folders for Library items, audiobooks and timelines. The project chosen at the bottom of the sidebar is where new work is filed. |
| **API key** | Save, test, replace or remove your `VOXTTS_API_KEY`. Shows the models it unlocks, the characters this app spent per model, and how much the cache saved. |
| **Local models** | Search Hugging Face and ModelScope, pick files, download with progress (falling back to the other hub per file), and install a runtime with one click. |
| **Timeline editor** (add-on) | Multi-track script timeline: one track per character, timed lines, Flash previews, a master render on any model, and a WAV mixdown to a file or to the Library. |

## Quick start

macOS / Linux:

```bash
./launch.sh
```

Windows: double-click `launch.bat`.

The launcher installs dependencies, builds the UI, starts the server and opens your browser. It needs Node.js 18.18 or newer. If no key is saved, the app opens on the **API key** tab. Testing the key calls `GET /api/v1/models`, which costs nothing.

For development with hot reload:

```bash
npm install
npm run dev
```

## Local models

Local inference needs **Python 3.9+** (3.10–3.12 is best). Everything installs into a private virtual environment under `data/runtime`, and your system Python is never touched. Install only the runtimes you need from the Local models tab:

| Runtime | Runs | Try |
| --- | --- | --- |
| Piper | Piper ONNX voices, ~60 MB each | `rhasspy/piper-voices` (pick one voice folder) |
| Kokoro (ONNX) | Kokoro-82M with 50+ voices, no PyTorch | `fastrtc/kokoro-onnx` |
| Kokoro (PyTorch) | `hexgrad/Kokoro-82M` with `.pt` voice packs | needs Python ≤ 3.12 |
| Transformers | any `text-to-speech` or `automatic-speech-recognition` pipeline model: MMS-TTS, VITS, Bark, Whisper, wav2vec2… | `facebook/mms-tts-eng`, `openai/whisper-tiny` |
| faster-whisper | Whisper converted to CTranslate2 | `Systran/faster-whisper-small` |

Any repository on either hub can be downloaded. The runtime is detected from its files, and you can override the runtime and the task. Downloads try Hugging Face first. If HF fails or rate-limits, the same file is fetched from ModelScope, which mirrors most speech repos under the same id or under `AI-ModelScope/` or `openai-mirror/`. Under **Hub settings** you can add a Hugging Face token (higher limits, gated models) or point at another HF mirror such as `https://hf-mirror.com`.

Audio for local transcription is converted to 16 kHz mono WAV in the browser, so ffmpeg is not needed.

## How it works

| Piece | Where |
| --- | --- |
| UI: React + Vite + Tailwind, shadcn-style components | `src/app`, `src/pages`, `src/components` |
| Timeline editor add-on | `src/editor`, `server/routes/timelines.js` |
| Local API server: Express, bound to `127.0.0.1` | `server/index.js`, `server/routes/*` |
| SQLite (better-sqlite3): settings, projects, library, usage, timelines, local models | `server/db.js` → `data/vox-studio.db` |
| VoxTTS client and request cache | `server/vox.js` → `data/cache/<hash>.mp3` |
| Library files | `data/library/` |
| Hub search and downloads (HF + ModelScope) | `server/local/hub.js` → `data/models/` |
| Python runtime manager and worker | `server/local/runtime.js`, `local-runtime/runner.py` |
| Model capabilities and tag translation | `shared/directives.js` |

**The key stays local.** It is stored in `data/vox-studio.db` and only the local server sends it, as a bearer token to `https://voxtts.app/api/v1/*`. The browser never receives it. A `VOXTTS_API_KEY` environment variable also works.

**Renders are cached.** Each request is keyed by a hash of text, voice, model, instruction and options. Replaying a line, editing another one, or pressing Generate twice never spends characters again. The API key tab shows how much the cache has saved.

**Projects are pointers.** Moving an item between projects never re-renders or bills anything. Deleting a project keeps its contents unless you choose to delete them.

## Configuration

| Env var | Default |
| --- | --- |
| `PORT` | `3000` |
| `HOST` | `127.0.0.1` |
| `VOX_STUDIO_DATA_DIR` | `./data` |
| `VOXTTS_API_KEY` | (fallback when no key is saved) |
| `VOXTTS_BASE_URL` | `https://voxtts.app` |
| `HF_TOKEN`, `HF_ENDPOINT`, `MODELSCOPE_ENDPOINT` | (can also be set in Hub settings) |
