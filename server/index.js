import fs from "node:fs";
import path from "node:path";
import express from "express";
import {
  CACHE_DIR,
  db,
  getSetting,
  projectIdForSegment,
  projectIdForTrack,
  seedDemoProject,
  setSetting,
  touchProject,
} from "./db.js";
import {
  DEFAULT_BASE_URL,
  VoxError,
  apiKey,
  baseUrl,
  buildRequest,
  cachePath,
  clearVoiceCache,
  hashRequest,
  isCached,
  listModels,
  listVoices,
  synthesize,
} from "./vox.js";
import { MASTER_MODELS, MODELS, PREVIEW_MODEL } from "../shared/directives.js";

const PORT = Number(process.env.PORT) || 3000;
// Local-first: only this machine can reach the server (and the saved key).
const HOST = process.env.HOST || "127.0.0.1";
const DEV = process.argv.includes("--dev");

seedDemoProject();

const app = express();
app.use(express.json({ limit: "1mb" }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (what) => new VoxError(404, `${what} not found`);

// ---------- settings ----------

function settingsView() {
  const key = apiKey();
  return {
    hasKey: Boolean(key),
    keySource: getSetting("voxtts_api_key") ? "saved" : key ? "env" : null,
    keyHint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
    baseUrl: baseUrl(),
    defaultBaseUrl: DEFAULT_BASE_URL,
  };
}

app.get("/api/settings", (_req, res) => res.json(settingsView()));

app.put("/api/settings", (req, res) => {
  const { apiKey: key, baseUrl: url } = req.body;
  if (key !== undefined) setSetting("voxtts_api_key", String(key).trim());
  if (url !== undefined) {
    const trimmed = String(url).trim();
    if (trimmed && !/^https?:\/\//.test(trimmed)) throw new VoxError(400, "Base URL must start with http(s)://");
    setSetting("voxtts_base_url", trimmed === DEFAULT_BASE_URL ? "" : trimmed);
  }
  clearVoiceCache();
  res.json(settingsView());
});

// GET /api/v1/models costs no quota, so it is the safe way to check a key.
app.post("/api/settings/test", wrap(async (_req, res) => res.json({ ok: true, ...(await listModels()) })));

app.get("/api/models", (_req, res) => res.json({ models: MODELS, preview: PREVIEW_MODEL, master: MASTER_MODELS }));

app.get("/api/voices", wrap(async (req, res) => {
  const model = String(req.query.model || PREVIEW_MODEL);
  res.json({ voices: await listVoices(model) });
}));

// ---------- projects ----------

app.get("/api/projects", (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM tracks t WHERE t.project_id = p.id) AS track_count
         FROM projects p ORDER BY updated_at DESC`,
      )
      .all(),
  );
});

app.post("/api/projects", (req, res) => {
  const name = String(req.body.name || "Untitled script").slice(0, 120);
  const id = db.prepare("INSERT INTO projects (name) VALUES (?)").run(name).lastInsertRowid;
  db.prepare("INSERT INTO tracks (project_id, name, voice_id, position) VALUES (?, 'Narrator', 'Ashley', 0)").run(id);
  res.status(201).json(loadProject(id));
});

const durationOf = db.prepare("SELECT duration_ms FROM audio_cache WHERE hash = ?");

/** A project with its tracks and segments, each segment annotated with the cache state of both renders. */
function loadProject(id) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) throw notFound("Project");
  const tracks = db.prepare("SELECT * FROM tracks WHERE project_id = ? ORDER BY position, id").all(id);
  const segments = db
    .prepare(
      `SELECT s.* FROM segments s JOIN tracks t ON t.id = s.track_id
       WHERE t.project_id = ? ORDER BY s.start_ms, s.id`,
    )
    .all(id);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const s of segments) Object.assign(s, renderState(s, byId.get(s.track_id), project.master_model));
  return { ...project, tracks, segments };
}

function renderState(segment, track, masterModel) {
  const state = {};
  for (const [prefix, model] of [["preview", PREVIEW_MODEL], ["master", masterModel]]) {
    const body = buildRequest({ segment, track, model });
    const hash = hashRequest(body);
    const ready = isCached(hash);
    state[`${prefix}_hash`] = hash;
    state[`${prefix}_ready`] = ready;
    state[`${prefix}_chars`] = body.text.length;
    state[`${prefix}_duration_ms`] = ready ? durationOf.get(hash)?.duration_ms ?? null : null;
  }
  return state;
}

app.get("/api/projects/:id", (req, res) => res.json(loadProject(req.params.id)));

app.patch("/api/projects/:id", (req, res) => {
  const { name, master_model } = req.body;
  if (master_model !== undefined && !MASTER_MODELS.includes(master_model))
    throw new VoxError(400, `master_model must be one of ${MASTER_MODELS.join(", ")}`);
  db.prepare(
    `UPDATE projects SET name = COALESCE(?, name), master_model = COALESCE(?, master_model),
     updated_at = datetime('now') WHERE id = ?`,
  ).run(name ?? null, master_model ?? null, req.params.id);
  res.json(loadProject(req.params.id));
});

app.delete("/api/projects/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ---------- tracks ----------

const TRACK_FIELDS = ["name", "color", "voice_id", "master_voice_id", "direction", "position", "muted", "solo", "gain"];

function patchRow(table, fields, id, body) {
  const entries = Object.entries(body).filter(([k]) => fields.includes(k));
  if (!entries.length) return;
  const values = entries.map(([, v]) => (typeof v === "boolean" ? Number(v) : v));
  const info = db
    .prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...values, id);
  if (!info.changes) throw notFound(table === "tracks" ? "Track" : "Segment");
}

app.post("/api/projects/:id/tracks", (req, res) => {
  const pid = req.params.id;
  if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(pid)) throw notFound("Project");
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 p FROM tracks WHERE project_id = ?").get(pid).p;
  const palette = ["#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#f87171", "#2dd4bf"];
  const { name = `Character ${position + 1}`, voice_id = "Ashley", color = palette[position % palette.length] } = req.body;
  db.prepare("INSERT INTO tracks (project_id, name, voice_id, color, position) VALUES (?, ?, ?, ?, ?)").run(
    pid, name, voice_id, color, position,
  );
  touchProject(pid);
  res.status(201).json(loadProject(pid));
});

app.patch("/api/tracks/:id", (req, res) => {
  const pid = projectIdForTrack(req.params.id);
  if (!pid) throw notFound("Track");
  patchRow("tracks", TRACK_FIELDS, req.params.id, req.body);
  touchProject(pid);
  res.json(loadProject(pid));
});

app.delete("/api/tracks/:id", (req, res) => {
  const pid = projectIdForTrack(req.params.id);
  if (!pid) throw notFound("Track");
  db.prepare("DELETE FROM tracks WHERE id = ?").run(req.params.id);
  touchProject(pid);
  res.json(loadProject(pid));
});

// ---------- segments ----------

const SEGMENT_FIELDS = ["text", "instruction", "start_ms", "track_id"];

app.post("/api/tracks/:id/segments", (req, res) => {
  const pid = projectIdForTrack(req.params.id);
  if (!pid) throw notFound("Track");
  const { text = "", instruction = "", start_ms = 0 } = req.body;
  const id = db
    .prepare("INSERT INTO segments (track_id, text, instruction, start_ms) VALUES (?, ?, ?, ?)")
    .run(req.params.id, text, instruction, Math.max(0, Math.round(start_ms))).lastInsertRowid;
  touchProject(pid);
  res.status(201).json({ id: Number(id), project: loadProject(pid) });
});

app.patch("/api/segments/:id", (req, res) => {
  const pid = projectIdForSegment(req.params.id);
  if (!pid) throw notFound("Segment");
  if (req.body.track_id !== undefined && projectIdForTrack(req.body.track_id) !== pid)
    throw new VoxError(400, "Segments can only move between tracks of the same project");
  if (req.body.start_ms !== undefined) req.body.start_ms = Math.max(0, Math.round(req.body.start_ms));
  patchRow("segments", SEGMENT_FIELDS, req.params.id, req.body);
  db.prepare("UPDATE segments SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  touchProject(pid);
  res.json(loadProject(pid));
});

// Bulk move, used by "pack timeline" so it is one write instead of N.
app.post("/api/projects/:id/arrange", (req, res) => {
  const pid = Number(req.params.id);
  const move = db.prepare("UPDATE segments SET start_ms = ? WHERE id = ?");
  db.transaction((items) => {
    for (const { id, start_ms } of items) {
      if (projectIdForSegment(id) !== pid) throw new VoxError(400, `Segment ${id} is not in this project`);
      move.run(Math.max(0, Math.round(start_ms)), id);
    }
  })(req.body.segments || []);
  touchProject(pid);
  res.json(loadProject(pid));
});

app.delete("/api/segments/:id", (req, res) => {
  const pid = projectIdForSegment(req.params.id);
  if (!pid) throw notFound("Segment");
  db.prepare("DELETE FROM segments WHERE id = ?").run(req.params.id);
  touchProject(pid);
  res.json(loadProject(pid));
});

/**
 * Render a segment. tier "preview" always uses vox-2-flash; "master" uses the
 * project's master model. Served from the disk cache when possible.
 */
app.post("/api/segments/:id/render", wrap(async (req, res) => {
  const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(req.params.id);
  if (!segment) throw notFound("Segment");
  const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(segment.track_id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(track.project_id);
  const tier = req.body.tier === "master" ? "master" : "preview";
  const model = tier === "master" ? project.master_model : PREVIEW_MODEL;
  const body = buildRequest({ segment, track, model });
  const started = Date.now();
  const result = await synthesize(body);
  res.json({
    ...result,
    tier,
    model,
    url: `/api/audio/${result.hash}.mp3`,
    request: { ...body, text: body.text },
    ms: Date.now() - started,
  });
}));

// What "Render Master" would cost before anything is spent.
app.get("/api/projects/:id/master-plan", (req, res) => {
  const project = loadProject(req.params.id);
  const segs = project.segments.filter((s) => s.text.trim());
  const pending = segs.filter((s) => !s.master_ready);
  res.json({
    model: project.master_model,
    segments: segs.length,
    cached: segs.length - pending.length,
    billable_chars: pending.reduce((n, s) => n + s.master_chars, 0),
    total_chars: segs.reduce((n, s) => n + s.master_chars, 0),
    too_long: segs.filter((s) => s.master_chars > MODELS[project.master_model].maxChars).map((s) => s.id),
  });
});

// ---------- audio cache ----------

app.get("/api/audio/:hash.mp3", (req, res) => {
  const file = cachePath(req.params.hash);
  if (!fs.existsSync(file)) throw notFound("Audio");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("audio/mpeg").sendFile(file);
});

// The browser decodes the audio anyway, so it reports the true duration back.
app.post("/api/audio/:hash/duration", (req, res) => {
  const ms = Math.round(Number(req.body.duration_ms));
  if (!Number.isFinite(ms) || ms <= 0) throw new VoxError(400, "duration_ms must be positive");
  db.prepare("UPDATE audio_cache SET duration_ms = ? WHERE hash = ?").run(ms, req.params.hash);
  res.status(204).end();
});

app.get("/api/cache", (_req, res) => {
  const row = db
    .prepare("SELECT COUNT(*) files, COALESCE(SUM(bytes),0) bytes, COALESCE(SUM(chars),0) chars, COALESCE(SUM(chars*hits),0) saved FROM audio_cache")
    .get();
  res.json({ ...row, dir: CACHE_DIR });
});

app.delete("/api/cache", (_req, res) => {
  for (const f of fs.readdirSync(CACHE_DIR)) if (f.endsWith(".mp3")) fs.rmSync(path.join(CACHE_DIR, f));
  db.prepare("DELETE FROM audio_cache").run();
  res.status(204).end();
});

app.use("/api", (_req, _res, next) => next(notFound("Route")));

// ---------- frontend ----------

const distDir = path.resolve("dist");
if (DEV) {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
} else {
  app.get("/", (_req, res) => res.status(503).send("Frontend not built. Run `npm run build` (or `npm run dev`)."));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
  if (status >= 500 && !(err instanceof VoxError)) console.error(err);
  res.status(status).json({ error: { message: err.message, code: err.code } });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Vox Studio running at http://localhost:${PORT}${DEV ? " (dev)" : ""}`);
  console.log(`  Data: ${path.resolve(CACHE_DIR, "..")}\n`);
});
