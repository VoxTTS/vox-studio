import fs from "node:fs";
import path from "node:path";
import { LIBRARY_DIR, db, resolveProjectId } from "./db.js";

const EXT = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac", "audio/webm": "webm", "audio/mp4": "m4a" };

export function extFor(mime) {
  return EXT[mime] || "bin";
}

/**
 * File something in the Library. `data` is a Buffer or a path to copy, so a
 * Library item survives the render cache being cleared.
 */
export function saveToLibrary({ kind, title, text = "", engine = "cloud", model = "", voice = "", data, mime, chars = 0, durationMs = null, meta = {}, projectId = null }) {
  const row = db
    .prepare(
      `INSERT INTO library_items (kind, title, text, engine, model, voice, mime, chars, duration_ms, meta, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(kind, title.slice(0, 200), text, engine, model, voice, mime ?? null, chars, durationMs, JSON.stringify(meta), resolveProjectId(projectId));
  const id = Number(row.lastInsertRowid);
  if (data) {
    const file = `${id}.${extFor(mime)}`;
    const dest = path.join(LIBRARY_DIR, file);
    if (Buffer.isBuffer(data)) fs.writeFileSync(dest, data);
    else fs.copyFileSync(data, dest);
    db.prepare("UPDATE library_items SET file = ?, bytes = ? WHERE id = ?").run(file, fs.statSync(dest).size, id);
  }
  return getLibraryItem(id);
}

export function getLibraryItem(id) {
  const row = db.prepare("SELECT * FROM library_items WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, meta: JSON.parse(row.meta || "{}"), url: row.file ? `/api/library/${row.id}/file` : null };
}

export function deleteLibraryItem(id) {
  const row = db.prepare("SELECT file FROM library_items WHERE id = ?").get(id);
  if (!row) return false;
  if (row.file) fs.rmSync(path.join(LIBRARY_DIR, row.file), { force: true });
  db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
  return true;
}

/** A short, readable title from the start of some text. */
export function titleFrom(text, fallback = "Untitled") {
  const clean = text.replace(/<[^>]+>|\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}
