import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DATA_DIR = process.env.VOX_STUDIO_DATA_DIR || path.resolve("data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "vox-studio.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    master_model TEXT NOT NULL DEFAULT 'vox-3-studio',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id              INTEGER PRIMARY KEY,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  CREATE INDEX IF NOT EXISTS tracks_project ON tracks(project_id);
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
`);

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

export function touchProject(projectId) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
}

export function projectIdForTrack(trackId) {
  return db.prepare("SELECT project_id FROM tracks WHERE id = ?").get(trackId)?.project_id;
}

export function projectIdForSegment(segmentId) {
  return db
    .prepare("SELECT t.project_id FROM segments s JOIN tracks t ON t.id = s.track_id WHERE s.id = ?")
    .get(segmentId)?.project_id;
}

/** First run: a small two-character scene that shows off the directives. */
export function seedDemoProject() {
  if (db.prepare("SELECT COUNT(*) n FROM projects").get().n > 0) return;
  const tx = db.transaction(() => {
    const p = db.prepare("INSERT INTO projects (name) VALUES (?)").run("The Heist — Scene 1").lastInsertRowid;
    const addTrack = db.prepare(
      "INSERT INTO tracks (project_id, name, color, voice_id, direction, position) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const mara = addTrack.run(p, "Mara", "#a78bfa", "Ashley", "sharp, quick-witted thief", 0).lastInsertRowid;
    const dex = addTrack.run(p, "Dex", "#34d399", "Marcus", "nervous rookie", 1).lastInsertRowid;
    const addSeg = db.prepare("INSERT INTO segments (track_id, text, instruction, start_ms) VALUES (?, ?, ?, ?)");
    addSeg.run(mara, "Okay. The guard changes shift in ninety seconds.", "whisper, conspiratorial", 0);
    addSeg.run(dex, "<gasp> Ninety? You said we'd have five minutes!", "panicked", 3600);
    addSeg.run(mara, "<sigh> I said a lot of things. <short pause> Move.", "dry, unimpressed", 7400);
    addSeg.run(dex, "<laugh> Right. Moving. Totally fine.", "forced cheer, voice cracking", 11400);
  });
  tx();
}
