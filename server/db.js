import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DATA_DIR = process.env.VOX_STUDIO_DATA_DIR || path.resolve("data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const LIBRARY_DIR = path.join(DATA_DIR, "library");
export const MODELS_DIR = path.join(DATA_DIR, "models");
for (const dir of [CACHE_DIR, LIBRARY_DIR, MODELS_DIR]) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "vox-studio.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// 0.1 called the editor's scripts "projects". Projects are now folders (as on
// voxtts.app), so the editor's table becomes "timelines".
if (columns("projects").includes("master_model")) {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    ALTER TABLE projects RENAME TO timelines;
    ALTER TABLE tracks RENAME COLUMN project_id TO timeline_id;
  `);
  db.pragma("foreign_keys = ON");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Folders for Library items, audiobooks and timelines.
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#8b5cf6',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every generated clip, podcast, downloaded audiobook, transcript and local-model render.
  CREATE TABLE IF NOT EXISTS library_items (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    engine      TEXT NOT NULL DEFAULT 'cloud',
    model       TEXT NOT NULL DEFAULT '',
    voice       TEXT NOT NULL DEFAULT '',
    file        TEXT,
    mime        TEXT,
    bytes       INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    chars       INTEGER NOT NULL DEFAULT 0,
    meta        TEXT NOT NULL DEFAULT '{}',
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS library_project ON library_items(project_id, created_at);

  -- Audiobooks render on voxtts.app; this keeps the local filing (project) for each.
  CREATE TABLE IF NOT EXISTS audiobooks (
    remote_id   TEXT PRIMARY KEY,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Characters this app spent on the VoxTTS API, for the API key tab.
  CREATE TABLE IF NOT EXISTS usage_log (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL,
    model      TEXT NOT NULL,
    chars      INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Editor add-on.
  CREATE TABLE IF NOT EXISTS timelines (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    master_model TEXT NOT NULL DEFAULT 'vox-3-studio',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id              INTEGER PRIMARY KEY,
    timeline_id     INTEGER NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#8b5cf6',
    voice_id        TEXT NOT NULL DEFAULT 'Ashley',
    master_voice_id TEXT NOT NULL DEFAULT '',
    direction       TEXT NOT NULL DEFAULT '',
    position        INTEGER NOT NULL DEFAULT 0,
    muted           INTEGER NOT NULL DEFAULT 0,
    solo            INTEGER NOT NULL DEFAULT 0,
    gain            REAL NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS segments (
    id          INTEGER PRIMARY KEY,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    text        TEXT NOT NULL DEFAULT '',
    instruction TEXT NOT NULL DEFAULT '',
    start_ms    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS segments_track ON segments(track_id);
  CREATE INDEX IF NOT EXISTS tracks_timeline ON tracks(timeline_id);

  -- One row per rendered file in data/cache, keyed by the request hash.
  CREATE TABLE IF NOT EXISTS audio_cache (
    hash         TEXT PRIMARY KEY,
    model        TEXT NOT NULL,
    voice_id     TEXT NOT NULL,
    chars        INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    duration_ms  INTEGER,
    hits         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Open-source models downloaded from Hugging Face or ModelScope.
  CREATE TABLE IF NOT EXISTS local_models (
    id          TEXT PRIMARY KEY,
    repo_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    task        TEXT NOT NULL,
    adapter     TEXT NOT NULL,
    status      TEXT NOT NULL,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    bytes_done  INTEGER NOT NULL DEFAULT 0,
    files       TEXT NOT NULL DEFAULT '[]',
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (!columns("timelines").includes("project_id"))
  db.exec("ALTER TABLE timelines ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");

export function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}

export function setSetting(key, value) {
  if (value === null || value === "") db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  else
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
}

export function logUsage(kind, model, chars) {
  if (chars > 0) db.prepare("INSERT INTO usage_log (kind, model, chars) VALUES (?, ?, ?)").run(kind, model, chars);
}

/** A project id from the browser, if it names a live project; otherwise null (unfiled). */
export function resolveProjectId(id) {
  if (id === undefined || id === null || id === "") return null;
  return db.prepare("SELECT id FROM projects WHERE id = ? AND archived = 0").get(Number(id))?.id ?? null;
}

export function touchTimeline(timelineId) {
  db.prepare("UPDATE timelines SET updated_at = datetime('now') WHERE id = ?").run(timelineId);
}

export function timelineIdForTrack(trackId) {
  return db.prepare("SELECT timeline_id FROM tracks WHERE id = ?").get(trackId)?.timeline_id;
}

export function timelineIdForSegment(segmentId) {
  return db
    .prepare("SELECT t.timeline_id FROM segments s JOIN tracks t ON t.id = s.track_id WHERE s.id = ?")
    .get(segmentId)?.timeline_id;
}

/** First run: a small two-character scene that shows off the directives. */
export function seedDemoTimeline() {
  if (db.prepare("SELECT COUNT(*) n FROM timelines").get().n > 0) return;
  db.transaction(() => {
    const p = db.prepare("INSERT INTO timelines (name) VALUES (?)").run("The Heist — Scene 1").lastInsertRowid;
    const addTrack = db.prepare(
      "INSERT INTO tracks (timeline_id, name, color, voice_id, master_voice_id, direction, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const mara = addTrack.run(p, "Mara", "#a78bfa", "Ashley", "Eloise", "sharp, quick-witted thief", 0).lastInsertRowid;
    const dex = addTrack.run(p, "Dex", "#34d399", "Dennis", "Calvin", "nervous rookie", 1).lastInsertRowid;
    const addSeg = db.prepare("INSERT INTO segments (track_id, text, instruction, start_ms) VALUES (?, ?, ?, ?)");
    addSeg.run(mara, "Okay. The guard changes shift in ninety seconds.", "whisper, conspiratorial", 0);
    addSeg.run(dex, "<gasp> Ninety? You said we'd have five minutes!", "panicked", 3600);
    addSeg.run(mara, "<sigh> I said a lot of things. <short pause> Move.", "dry, unimpressed", 7400);
    addSeg.run(dex, "<laugh> Right. Moving. Totally fine.", "forced cheer, voice cracking", 11400);
  })();
}
