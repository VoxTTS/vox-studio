import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { CACHE_DIR, logUsage } from "../db.js";
import { badRequest, wrap } from "../http.js";
import { MODELS } from "../../shared/directives.js";
import { clearVoiceCache, listVoices, synthesize, voxJson } from "../vox.js";

export const voices = Router();

const PREVIEW_LINE = "Hi there! This is a short sample of how I sound.";

// Previews use the cheapest model that can speak a catalogue's voices.
const PREVIEW_MODEL_FOR = {
  "vox-2": "vox-2-flash",
  "vox-3-studio": "vox-3-express",
};

voices.get(
  "/voices",
  wrap(async (req, res) => {
    const model = String(req.query.model || "vox-2");
    if (!MODELS[model]) throw badRequest(`Unknown model ${model}`);
    res.json({ model, catalog: MODELS[model].catalog, voices: await listVoices(model) });
  }),
);

/**
 * A short sample of a voice. Spends ~50 characters the first time; after that
 * it comes from the disk cache for good.
 */
voices.post(
  "/voices/preview",
  wrap(async (req, res) => {
    const { model = "vox-2", voice_id, language } = req.body;
    if (!voice_id) throw badRequest("voice_id is required");
    const catalog = MODELS[model]?.catalog ?? "vox-2";
    const body = { text: PREVIEW_LINE, voice_id, model: PREVIEW_MODEL_FOR[catalog] ?? catalog, format: "mp3" };
    if (language && catalog === "vox-3.5") body.language = language;
    const r = await synthesize(body, "voice preview");
    res.json({ url: `/api/audio/${r.hash}.mp3`, cached: r.cached, chars: r.chars, model: body.model });
  }),
);

voices.post(
  "/voices/design",
  wrap(async (req, res) => {
    const { prompt, preview_text, samples = 2, language } = req.body;
    if (!prompt || prompt.trim().length < 20) throw badRequest("Describe the voice in at least 20 characters.");
    const out = await voxJson("/api/v1/voices/design", {
      json: { prompt, preview_text: preview_text || undefined, samples, language: language || undefined },
      timeout: 300_000,
    });
    logUsage("voice design", "vox-2", (out.preview_text || "").length * (out.candidates?.length || samples));
    res.json(out);
  }),
);

voices.post(
  "/voices/design/publish",
  wrap(async (req, res) => {
    const out = await voxJson("/api/v1/voices/design/publish", { json: req.body });
    clearVoiceCache();
    res.json(out);
  }),
);

voices.patch(
  "/voices/:id",
  wrap(async (req, res) => {
    const out = await voxJson(`/api/v1/voices/${encodeURIComponent(req.params.id)}`, { method: "PATCH", json: req.body });
    clearVoiceCache();
    res.json(out);
  }),
);

voices.delete(
  "/voices/:id",
  wrap(async (req, res) => {
    await voxJson(`/api/v1/voices/${encodeURIComponent(req.params.id)}`, { method: "DELETE" });
    clearVoiceCache();
    res.status(204).end();
  }),
);

/** Cached renders (voice previews, editor segments, playground clips) by content hash. */
voices.get("/audio/:file", (req, res) => {
  if (!/^[0-9a-f]{32}\.(mp3|wav|ogg|flac)$/.test(req.params.file)) throw badRequest("Bad audio id");
  const file = path.join(CACHE_DIR, req.params.file);
  if (!fs.existsSync(file)) return res.status(404).json({ error: { message: "Audio not found" } });
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(file);
});
