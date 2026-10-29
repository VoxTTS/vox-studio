import { Router } from "express";
import { db, resolveProjectId } from "../db.js";
import { badRequest, wrap } from "../http.js";
import { saveToLibrary } from "../library.js";
import { voxFetch, voxJson } from "../vox.js";

// Audiobooks render in the background on voxtts.app (POST /api/v1/audiobooks).
// Locally we only remember which project each book is filed in.
export const audiobooks = Router();

const projectOf = db.prepare("SELECT project_id FROM audiobooks WHERE remote_id = ?");
const withProject = (book) => ({ ...book, project_id: projectOf.get(book.id)?.project_id ?? null });
const bookPath = (id) => `/api/v1/audiobooks/${encodeURIComponent(id)}`;

audiobooks.get(
  "/audiobooks",
  wrap(async (req, res) => {
    const { audiobooks: books = [] } = await voxJson("/api/v1/audiobooks");
    const filter = String(req.query.project || "all");
    const listed = books.map(withProject).filter((b) =>
      filter === "all" ? true : filter === "unfiled" ? b.project_id === null : b.project_id === Number(filter),
    );
    res.json({ audiobooks: listed });
  }),
);

audiobooks.post(
  "/audiobooks",
  wrap(async (req, res) => {
    const { project_id, ...body } = req.body;
    if (!body.text?.trim()) throw badRequest("Paste or upload the manuscript.");
    if (!body.narrator_voice) throw badRequest("Pick a narrator voice.");
    const out = await voxJson("/api/v1/audiobooks", { json: body, timeout: 300_000 });
    const id = out.audiobook?.id;
    if (id)
      db.prepare("INSERT OR REPLACE INTO audiobooks (remote_id, project_id) VALUES (?, ?)").run(id, resolveProjectId(project_id));
    res.status(201).json({ ...out, audiobook: out.audiobook && withProject(out.audiobook) });
  }),
);

audiobooks.get(
  "/audiobooks/:id",
  wrap(async (req, res) => {
    const out = await voxJson(bookPath(req.params.id));
    res.json({ ...out, audiobook: withProject(out.audiobook) });
  }),
);

for (const action of ["render", "cancel"])
  audiobooks.post(
    `/audiobooks/:id/${action}`,
    wrap(async (req, res) => res.json(await voxJson(`${bookPath(req.params.id)}/${action}`, { json: req.body ?? {} }))),
  );

audiobooks.delete(
  "/audiobooks/:id",
  wrap(async (req, res) => {
    await voxJson(bookPath(req.params.id), { method: "DELETE" });
    db.prepare("DELETE FROM audiobooks WHERE remote_id = ?").run(req.params.id);
    res.status(204).end();
  }),
);

/** Download a finished book (mp3, m4b or zip) into the Library. */
audiobooks.post(
  "/audiobooks/:id/save",
  wrap(async (req, res) => {
    const format = ["mp3", "m4b", "zip"].includes(req.body.format) ? req.body.format : "mp3";
    const { audiobook: book } = await voxJson(bookPath(req.params.id));
    // The API answers with a redirect to a short-lived signed URL; fetch drops
    // the Authorization header when it follows it to another host.
    const upstream = await voxFetch(`${bookPath(req.params.id)}/download?format=${format}`, { timeout: 600_000 });
    const data = Buffer.from(await upstream.arrayBuffer());
    const mime = { mp3: "audio/mpeg", m4b: "audio/mp4", zip: "application/zip" }[format];
    const item = saveToLibrary({
      kind: "audiobook",
      title: `${book.title || "Audiobook"}${format === "mp3" ? "" : ` (${format.toUpperCase()})`}`,
      text: (book.chapters ?? []).map((c, i) => `${i + 1}. ${c.title}`).join("\n"),
      model: book.model,
      voice: book.narrator_voice,
      data,
      mime,
      chars: 0,
      durationMs: book.audio_seconds ? book.audio_seconds * 1000 : null,
      meta: { audiobook_id: book.id, format },
      projectId: req.body.project_id ?? projectOf.get(book.id)?.project_id,
    });
    res.json({ item });
  }),
);
