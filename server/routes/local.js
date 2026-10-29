import { Router } from "express";
import { db, getSetting, setSetting } from "../db.js";
import { badRequest, notFound, wrap } from "../http.js";
import {
  cancelDownload,
  detectAdapter,
  hfEndpoint,
  listFiles,
  modelVoices,
  msEndpoint,
  removeModel,
  searchModels,
  startDownload,
  suggestFiles,
} from "../local/hub.js";
import { ADAPTERS, runtime } from "../local/runtime.js";

export const local = Router();

const view = (row) => ({
  ...row,
  files: JSON.parse(row.files),
  voices: row.status === "ready" ? modelVoices(row) : [],
});

local.get("/local/runtime", (_req, res) => res.json(runtime.status()));

local.post("/local/runtime/install", (req, res) => {
  runtime.install(String(req.body.adapter));
  res.status(202).json(runtime.status());
});

local.get("/local/hub", (_req, res) => {
  res.json({ hfEndpoint: hfEndpoint(), msEndpoint: msEndpoint(), hasHfToken: Boolean(getSetting("hf_token") || process.env.HF_TOKEN) });
});

local.put("/local/hub", (req, res) => {
  const { hfToken, hfEndpoint: hf, msEndpoint: ms } = req.body;
  if (hfToken !== undefined) setSetting("hf_token", String(hfToken).trim());
  if (hf !== undefined) setSetting("hf_endpoint", String(hf).trim().replace(/\/+$/, ""));
  if (ms !== undefined) setSetting("ms_endpoint", String(ms).trim().replace(/\/+$/, ""));
  res.json({ hfEndpoint: hfEndpoint(), msEndpoint: msEndpoint(), hasHfToken: Boolean(getSetting("hf_token") || process.env.HF_TOKEN) });
});

local.get(
  "/local/search",
  wrap(async (req, res) => {
    const task = req.query.task === "stt" ? "stt" : "tts";
    res.json(await searchModels({ q: String(req.query.q || ""), task, source: String(req.query.source || "auto") }));
  }),
);

/** A repo's files, the suggested selection and the runtime that would run it. */
local.get(
  "/local/files",
  wrap(async (req, res) => {
    const repo = String(req.query.repo || "").trim();
    const listing = await listFiles(repo, String(req.query.source || "auto"));
    const suggested = suggestFiles(listing.files);
    res.json({ ...listing, suggested, detected: detectAdapter(repo, suggested, req.query.task || undefined) });
  }),
);

local.get("/local/models", (_req, res) => {
  res.json({ models: db.prepare("SELECT * FROM local_models ORDER BY created_at DESC").all().map(view) });
});

local.post(
  "/local/models",
  wrap(async (req, res) => {
    const { repo, source = "auto", paths, task, adapter, name } = req.body;
    if (!Array.isArray(paths) || !paths.length) throw badRequest("Select the files to download.");
    if (adapter && adapter !== "unsupported" && !ADAPTERS[adapter]) throw badRequest(`Unknown runtime ${adapter}`);
    // Re-list so sizes and the serving hub come from the hub, not the browser.
    const listing = await listFiles(repo, source);
    const id = startDownload({ repo: listing.repo, requested: repo, source: listing.source, files: listing.files, paths, task, adapter, name });
    res.status(202).json({ model: view(db.prepare("SELECT * FROM local_models WHERE id = ?").get(id)) });
  }),
);

local.patch("/local/models/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM local_models WHERE id = ?").get(req.params.id);
  if (!row) throw notFound("Model");
  const { adapter, task } = req.body;
  if (adapter !== undefined && adapter !== "unsupported" && !ADAPTERS[adapter]) throw badRequest(`Unknown runtime ${adapter}`);
  if (task !== undefined && !["tts", "stt"].includes(task)) throw badRequest("task is tts or stt");
  db.prepare("UPDATE local_models SET adapter = COALESCE(?, adapter), task = COALESCE(?, task) WHERE id = ?").run(
    adapter ?? null,
    task ?? null,
    row.id,
  );
  runtime.unload(row.id);
  res.json({ model: view(db.prepare("SELECT * FROM local_models WHERE id = ?").get(row.id)) });
});

local.post("/local/models/:id/cancel", (req, res) => {
  cancelDownload(req.params.id);
  res.status(202).json({ ok: true });
});

local.delete("/local/models/:id", (req, res) => {
  runtime.unload(req.params.id);
  removeModel(req.params.id);
  res.status(204).end();
});
