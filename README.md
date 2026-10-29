# Vox Studio

A local-first, multi-track script timeline editor for [VoxTTS](https://voxtts.app). Write multi-speaker scripts as tracks on a timeline (one per character), direct each line with vocal events and emotion annotations, audition lines instantly on `vox-2-flash`, then render a master on `vox-3-studio`, `vox-4` or `vox-2` and export a WAV mixdown.

Everything runs on your machine at **http://localhost:3000**. Projects live in a local SQLite database, and every rendered segment is cached on disk.

## Quick start

macOS / Linux:

```bash
./launch.sh
```

Windows: double-click `launch.bat`.

The launcher installs dependencies, builds the UI, starts the server and opens your browser. You need Node.js 18.18 or newer. On first launch the Settings dialog opens. Paste your `VOXTTS_API_KEY` and click **Test connection**. The test calls `GET /api/v1/models`, which costs no characters.

For development with hot reload:

```bash
npm install
npm run dev
```

## How it works

| Piece | Where |
| --- | --- |
| UI: React + Vite + Tailwind, shadcn-style components | `src/` |
| Local API server: Express, bound to `127.0.0.1` only | `server/index.js` |
| SQLite (better-sqlite3): projects, tracks, segments, settings, cache index | `server/db.js` → `data/vox-studio.db` |
| VoxTTS client and disk cache | `server/vox.js` → `data/cache/<hash>.mp3` |
| Directive parsing and per-model translation (shared by server and UI) | `shared/directives.js` |
| Playback, timeline scheduling and WAV mixdown (Web Audio) | `src/lib/audio.ts` |

The API key is stored in the local database. The browser never sees it: the UI calls the local server, and the local server calls `https://voxtts.app/api/v1/*` with `Authorization: Bearer …`. A `VOXTTS_API_KEY` environment variable also works as a fallback.

### Caching

Each render is keyed by a SHA-256 of the exact request: spoken text, `voice_id`, `model` and `instruction`. Editing one line, moving blocks around, or replaying the timeline never re-bills another line. Changing a line's text, voice, model or emotion creates a new key, so cached audio is never stale. The Render Master dialog shows how many characters will be billed before anything is sent. **Settings → Render cache** shows the cache size and how many characters cache hits have saved.

### Directives

Write directives once in canonical form. They are translated to each model's syntax at render time:

| You write | vox-2-flash / vox-2 | vox-3-studio | vox-4 |
| --- | --- | --- | --- |
| `<sigh>`, `<laugh>`, `<gasp>`… | `[sigh]` | `<sigh>` | dropped (not supported) |
| `<short pause>` / `<long pause>` | `<break time="0.5s" />` | `<short pause>` | `<\|0.5\|>` |
| Emotion field, e.g. `whisper, conspiratorial` | `instruction` (vox-2 only; Flash ignores it) | `instruction` | ignored |

Each track also has a **character direction**, for example "nervous rookie". It is prepended to every line's emotion annotation. Open **Request body** in the inspector to see exactly what will be sent.

### Voices

Vox 3 Studio and Vox 4 have their own voice catalogues, so each track has a **preview voice** (vox-2 catalogue) and an optional **master voice**. When a key is saved, both fields suggest voices from `GET /api/v1/voices?model=…`.

## Using the editor

- **Double-click a lane** to add a line at that time. Use **+ Line** on a track header to append one.
- **Drag a block** to move it in time or onto another character's track. Moves snap to 50 ms; hold Shift to turn snapping off.
- **Double-click a block**, or press **Ctrl/Cmd+Enter**, to preview it on Flash.
- **Space** plays or pauses the timeline. The **Preview / Master** toggle picks which renders you hear.
- **Preview missing** renders every line that has no preview yet. **Pack** re-spaces every line end to end in its current order.
- A block's width is an estimate until the line is rendered (dashed border). After that it matches the real audio length.
- **Render Master** renders the lines not yet cached on the master model, then lets you play the master or export a 48 kHz WAV mixdown. Mixing respects mute, solo and track gain.

## Configuration

| Env var | Default |
| --- | --- |
| `PORT` | `3000` |
| `HOST` | `127.0.0.1` |
| `VOX_STUDIO_DATA_DIR` | `./data` |
| `VOXTTS_API_KEY` | (fallback when no key is saved in Settings) |
| `VOXTTS_BASE_URL` | `https://voxtts.app` |
