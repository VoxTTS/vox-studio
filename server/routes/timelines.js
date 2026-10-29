import { Router } from "express";
import { db, resolveProjectId, timelineIdForSegment, timelineIdForTrack, touchTimeline } from "../db.js";
import { badRequest, notFound, wrap } from "../http.js";
import { MASTER_MODELS, MODELS, PREVIEW_MODEL } from "../../shared/directives.js";
import { buildRequest, hashRequest, isCached, synthesize } from "../vox.js";

// The timeline editor add-on: tracks per character, timed segments, preview on
// Flash and master renders, all through the shared disk cache.
export const timelines = Router();

timelines.get("/timelines", (req, res) => {
  const project = String(req.query.project ?? "all");
  const filter = project === "all" ? "" : project === "unfiled" ? "WHERE p.project_id IS NULL" : "WHERE p.project_id = ?";
  res.json(
    db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM tracks t WHERE t.timeline_id = p.id) AS track_count
         FROM timelines p ${filter} ORDER BY updated_at DESC`,
      )
      .all(...(filter.includes("?") ? [Number(project)] : [])),
  );
});

timelines.post("/timelines", (req, res) => {
  const name = String(req.body.name || "Untitled script").slice(0, 120);
  const id = db
    .prepare("INSERT INTO timelines (name, project_id) VALUES (?, ?)")
    .run(name, resolveProjectId(req.body.project_id)).lastInsertRowid;
  db.prepare("INSERT INTO tracks (timeline_id, name, voice_id, position) VALUES (?, 'Narrator', 'Ashley', 0)").run(id);
  res.status(201).json(loadTimeline(id));
});

const durationOf = db.prepare("SELECT duration_ms FROM audio_cache WHERE hash = ?");

/** A timeline with its tracks and segments, each segment annotated with the cache state of both renders. */
function loadTimeline(id) {
  const timeline = db.prepare("SELECT * FROM timelines WHERE id = ?").get(id);
  if (!timeline) throw notFound("Timeline");
  const tracks = db.prepare("SELECT * FROM tracks WHERE timeline_id = ? ORDER BY position, id").all(id);
  const segments = db
    .prepare(
      `SELECT s.* FROM segments s JOIN tracks t ON t.id = s.track_id
       WHERE t.timeline_id = ? ORDER BY s.start_ms, s.id`,
    )
    .all(id);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const s of segments) Object.assign(s, renderState(s, byId.get(s.track_id), timeline.master_model));
  return { ...timeline, tracks, segments };
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

timelines.get("/timelines/:id", (req, res) => res.json(loadTimeline(req.params.id)));

timelines.patch("/timelines/:id", (req, res) => {
  const { name, master_model, project_id } = req.body;
  if (master_model !== undefined && !MASTER_MODELS.includes(master_model))
    throw badRequest(`master_model must be one of ${MASTER_MODELS.join(", ")}`);
  db.prepare(
    `UPDATE timelines SET name = COALESCE(?, name), master_model = COALESCE(?, master_model),
     updated_at = datetime('now') WHERE id = ?`,
  ).run(name ?? null, master_model ?? null, req.params.id);
  if (project_id !== undefined)
    db.prepare("UPDATE timelines SET project_id = ? WHERE id = ?").run(resolveProjectId(project_id), req.params.id);
  res.json(loadTimeline(req.params.id));
});

timelines.delete("/timelines/:id", (req, res) => {
  db.prepare("DELETE FROM timelines WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ---------- tracks ----------

const TRACK_FIELDS = ["name", "color", "voice_id", "master_voice_id", "direction", "position", "muted", "solo", "gain"];
const SEGMENT_FIELDS = ["text", "instruction", "start_ms", "track_id"];

function patchRow(table, fields, id, body) {
  const entries = Object.entries(body).filter(([k]) => fields.includes(k));
  if (!entries.length) return;
  const values = entries.map(([, v]) => (typeof v === "boolean" ? Number(v) : v));
  const info = db
    .prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...values, id);
  if (!info.changes) throw notFound(table === "tracks" ? "Track" : "Segment");
}

timelines.post("/timelines/:id/tracks", (req, res) => {
  const tid = req.params.id;
  if (!db.prepare("SELECT 1 FROM timelines WHERE id = ?").get(tid)) throw notFound("Timeline");
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 p FROM tracks WHERE timeline_id = ?").get(tid).p;
  const palette = ["#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#f87171", "#2dd4bf"];
  const { name = `Character ${position + 1}`, voice_id = "Ashley", color = palette[position % palette.length] } = req.body;
  db.prepare("INSERT INTO tracks (timeline_id, name, voice_id, color, position) VALUES (?, ?, ?, ?, ?)").run(
    tid, name, voice_id, color, position,
  );
  touchTimeline(tid);
  res.status(201).json(loadTimeline(tid));
});

timelines.patch("/tracks/:id", (req, res) => {
  const tid = timelineIdForTrack(req.params.id);
  if (!tid) throw notFound("Track");
  patchRow("tracks", TRACK_FIELDS, req.params.id, req.body);
  touchTimeline(tid);
  res.json(loadTimeline(tid));
});

timelines.delete("/tracks/:id", (req, res) => {
  const tid = timelineIdForTrack(req.params.id);
  if (!tid) throw notFound("Track");
  db.prepare("DELETE FROM tracks WHERE id = ?").run(req.params.id);
  touchTimeline(tid);
  res.json(loadTimeline(tid));
});

// ---------- segments ----------

timelines.post("/tracks/:id/segments", (req, res) => {
  const tid = timelineIdForTrack(req.params.id);
  if (!tid) throw notFound("Track");
  const { text = "", instruction = "", start_ms = 0 } = req.body;
  const id = db
    .prepare("INSERT INTO segments (track_id, text, instruction, start_ms) VALUES (?, ?, ?, ?)")
    .run(req.params.id, text, instruction, Math.max(0, Math.round(start_ms))).lastInsertRowid;
  touchTimeline(tid);
  res.status(201).json({ id: Number(id), timeline: loadTimeline(tid) });
});

timelines.patch("/segments/:id", (req, res) => {
  const tid = timelineIdForSegment(req.params.id);
  if (!tid) throw notFound("Segment");
  if (req.body.track_id !== undefined && timelineIdForTrack(req.body.track_id) !== tid)
    throw badRequest("Segments can only move between tracks of the same timeline");
  if (req.body.start_ms !== undefined) req.body.start_ms = Math.max(0, Math.round(req.body.start_ms));
  patchRow("segments", SEGMENT_FIELDS, req.params.id, req.body);
  db.prepare("UPDATE segments SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  touchTimeline(tid);
  res.json(loadTimeline(tid));
});

// Bulk move, used by "pack timeline" so it is one write instead of N.
timelines.post("/timelines/:id/arrange", (req, res) => {
  const tid = Number(req.params.id);
  const move = db.prepare("UPDATE segments SET start_ms = ? WHERE id = ?");
  db.transaction((items) => {
    for (const { id, start_ms } of items) {
      if (timelineIdForSegment(id) !== tid) throw badRequest(`Segment ${id} is not in this timeline`);
      move.run(Math.max(0, Math.round(start_ms)), id);
    }
  })(req.body.segments || []);
  touchTimeline(tid);
  res.json(loadTimeline(tid));
});

timelines.delete("/segments/:id", (req, res) => {
  const tid = timelineIdForSegment(req.params.id);
  if (!tid) throw notFound("Segment");
  db.prepare("DELETE FROM segments WHERE id = ?").run(req.params.id);
  touchTimeline(tid);
  res.json(loadTimeline(tid));
});

/** Render a segment: "preview" on vox-2-flash, "master" on the timeline's master model. Cached on disk. */
timelines.post(
  "/segments/:id/render",
  wrap(async (req, res) => {
    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(req.params.id);
    if (!segment) throw notFound("Segment");
    const track = db.prepare("SELECT * FROM tracks WHERE id = ?").get(segment.track_id);
    const timeline = db.prepare("SELECT * FROM timelines WHERE id = ?").get(track.timeline_id);
    const tier = req.body.tier === "master" ? "master" : "preview";
    const model = tier === "master" ? timeline.master_model : PREVIEW_MODEL;
    const body = buildRequest({ segment, track, model });
    const started = Date.now();
    const { hash, cached, chars } = await synthesize(body, "editor");
    res.json({ hash, cached, chars, tier, model, url: `/api/audio/${hash}.mp3`, request: body, ms: Date.now() - started });
  }),
);

// What "Render Master" would cost before anything is spent.
timelines.get("/timelines/:id/master-plan", (req, res) => {
  const timeline = loadTimeline(req.params.id);
  const segs = timeline.segments.filter((s) => s.text.trim());
  const pending = segs.filter((s) => !s.master_ready);
  res.json({
    model: timeline.master_model,
    segments: segs.length,
    cached: segs.length - pending.length,
    billable_chars: pending.reduce((n, s) => n + s.master_chars, 0),
    total_chars: segs.reduce((n, s) => n + s.master_chars, 0),
    too_long: segs.filter((s) => s.master_chars > MODELS[timeline.master_model].maxChars).map((s) => s.id),
  });
});

// The browser decodes the audio anyway, so it reports the true duration back.
timelines.post("/audio/:hash/duration", (req, res) => {
  const ms = Math.round(Number(req.body.duration_ms));
  if (!Number.isFinite(ms) || ms <= 0) throw badRequest("duration_ms must be positive");
  db.prepare("UPDATE audio_cache SET duration_ms = ? WHERE hash = ?").run(ms, req.params.hash);
  res.status(204).end();
});
