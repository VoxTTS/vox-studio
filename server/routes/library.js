import path from "node:path";
import express, { Router } from "express";
import { LIBRARY_DIR, db, resolveProjectId } from "../db.js";
import { badRequest, notFound } from "../http.js";
import { deleteLibraryItem, getLibraryItem, saveToLibrary } from "../library.js";

export const library = Router();

// ---------- Library ----------

library.get("/library", (req, res) => {
  const where = [];
  const args = [];
  const project = String(req.query.project ?? "all");
  if (project === "unfiled") where.push("project_id IS NULL");
  else if (project !== "all") (where.push("project_id = ?"), args.push(Number(project)));
  if (req.query.kind) (where.push("kind = ?"), args.push(String(req.query.kind)));
  if (req.query.q) (where.push("(title LIKE ? OR text LIKE ?)"), args.push(`%${req.query.q}%`, `%${req.query.q}%`));
  const rows = db
    .prepare(`SELECT id FROM library_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT 500`)
    .all(...args);
  res.json({ items: rows.map((r) => getLibraryItem(r.id)) });
});

library.get("/library/:id/file", (req, res) => {
  const item = getLibraryItem(Number(req.params.id));
  if (!item?.file) throw notFound("File");
  if (req.query.download) res.attachment(`${item.title.replace(/[^\w\- ]+/g, "").trim() || "audio"}.${item.file.split(".").pop()}`);
  res.type(item.mime || "application/octet-stream").sendFile(path.join(LIBRARY_DIR, item.file));
});

/** Raw upload, e.g. an editor mixdown rendered in the browser. Options in the query. */
library.post("/library/upload", express.raw({ type: () => true, limit: "500mb" }), (req, res) => {
  if (!req.body?.length) throw badRequest("Empty upload");
  const q = req.query;
  const item = saveToLibrary({
    kind: String(q.kind || "upload"),
    title: String(q.title || "Upload"),
    text: String(q.text || ""),
    engine: String(q.engine || "local"),
    model: String(q.model || ""),
    data: req.body,
    mime: String(req.headers["content-type"] || "application/octet-stream"),
    durationMs: q.duration_ms ? Number(q.duration_ms) : null,
    projectId: q.project_id,
  });
  res.status(201).json({ item });
});

library.patch("/library/:id", (req, res) => {
  const item = getLibraryItem(Number(req.params.id));
  if (!item) throw notFound("Library item");
  const { title, project_id } = req.body;
  if (title !== undefined) db.prepare("UPDATE library_items SET title = ? WHERE id = ?").run(String(title).slice(0, 200), item.id);
  if (project_id !== undefined)
    db.prepare("UPDATE library_items SET project_id = ? WHERE id = ?").run(resolveProjectId(project_id), item.id);
  res.json({ item: getLibraryItem(item.id) });
});

library.delete("/library/:id", (req, res) => {
  if (!deleteLibraryItem(Number(req.params.id))) throw notFound("Library item");
  res.status(204).end();
});

// ---------- Projects (folders) ----------

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM library_items WHERE project_id = p.id) AS library,
    (SELECT COUNT(*) FROM audiobooks WHERE project_id = p.id) AS audiobooks,
    (SELECT COUNT(*) FROM timelines WHERE project_id = p.id) AS timelines
  FROM projects p WHERE p.id = ?`);

const projectView = (p) => ({ ...p, archived: Boolean(p.archived), counts: counts.get(p.id) });

library.get("/projects", (_req, res) => {
  res.json({ projects: db.prepare("SELECT * FROM projects ORDER BY archived, updated_at DESC").all().map(projectView) });
});

library.post("/projects", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw badRequest("Name the project.");
  if (db.prepare("SELECT COUNT(*) n FROM projects").get().n >= 50) throw badRequest("You can keep up to 50 projects.");
  const id = db
    .prepare("INSERT INTO projects (name, description, color) VALUES (?, ?, ?)")
    .run(name.slice(0, 80), String(req.body.description || ""), String(req.body.color || "#8b5cf6")).lastInsertRowid;
  res.status(201).json({ project: projectView(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)) });
});

library.patch("/projects/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) throw notFound("Project");
  const { name, description, color, archived } = req.body;
  db.prepare(
    `UPDATE projects SET name = ?, description = ?, color = ?, archived = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(
    name !== undefined ? String(name).trim().slice(0, 80) || p.name : p.name,
    description ?? p.description,
    color ?? p.color,
    archived === undefined ? p.archived : Number(Boolean(archived)),
    p.id,
  );
  res.json({ project: projectView(db.prepare("SELECT * FROM projects WHERE id = ?").get(p.id)) });
});

/** contents=unfile (default) returns everything to the Library; contents=delete removes local files too. */
library.delete("/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id)) throw notFound("Project");
  db.transaction(() => {
    if (req.query.contents === "delete") {
      for (const { id: item } of db.prepare("SELECT id FROM library_items WHERE project_id = ?").all(id)) deleteLibraryItem(item);
      db.prepare("DELETE FROM timelines WHERE project_id = ?").run(id);
    }
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  })();
  res.status(204).end();
});

/** Move items into a project (or out, with project_id null). Nothing is re-rendered or billed. */
library.post("/projects/move", (req, res) => {
  const target = req.body.project_id === null ? null : resolveProjectId(req.body.project_id);
  if (req.body.project_id !== null && target === null) throw badRequest("That project does not exist or is archived.");
  const { library: lib = [], audiobooks = [], timelines = [] } = req.body.items ?? {};
  db.transaction(() => {
    for (const id of lib) db.prepare("UPDATE library_items SET project_id = ? WHERE id = ?").run(target, id);
    for (const id of timelines) db.prepare("UPDATE timelines SET project_id = ? WHERE id = ?").run(target, id);
    for (const id of audiobooks)
      db.prepare(
        "INSERT INTO audiobooks (remote_id, project_id) VALUES (?, ?) ON CONFLICT(remote_id) DO UPDATE SET project_id = excluded.project_id",
      ).run(String(id), target);
  })();
  res.json({ ok: true });
});
