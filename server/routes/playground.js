import fs from "node:fs";
import express, { Router } from "express";
import { db, logUsage } from "../db.js";
import { badRequest, wrap } from "../http.js";
import { getLibraryItem, saveToLibrary, titleFrom } from "../library.js";
import { runtime } from "../local/runtime.js";
import { MODELS, translateText } from "../../shared/directives.js";
import { VoxError, synthesize, voxFetch, voxJson } from "../vox.js";

export const playground = Router();

const LANGUAGE_MODELS = new Set(["vox-2", "vox-2-flash", "vox-2.5", "vox-3.5"]);

/** Split at sentence ends (then words) so each piece fits one request. */
export function chunkText(text, max) {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n+|$)/g) ?? [text];
  const chunks = [];
  let cur = "";
  const push = () => cur.trim() && chunks.push(cur.trim());
  for (const s of sentences) {
    if ((cur + s).length <= max) {
      cur += s;
      continue;
    }
    push();
    cur = "";
    if (s.length <= max) cur = s;
    else for (const word of s.split(/(\s+)/)) (cur + word).length > max ? (push(), (cur = word)) : (cur += word);
  }
  push();
  return chunks;
}

/**
 * Text to speech. engine "cloud" calls /api/v1/tts (long text is chunked by
 * sentence and joined); "local:<id>" runs a downloaded open-source model.
 */
playground.post(
  "/speech",
  wrap(async (req, res) => {
    const { text = "", engine = "cloud", project_id, voice_id = "", model = "vox-2" } = req.body;
    if (!text.trim()) throw badRequest("Type something to say.");

    if (engine.startsWith("local:")) {
      const id = engine.slice(6);
      const out = await runtime.tts(id, { text, voice: voice_id || undefined, speed: req.body.speed });
      const item = saveToLibrary({
        kind: "speech",
        title: titleFrom(text),
        text,
        engine: "local",
        model: id,
        voice: voice_id,
        data: out.audio,
        mime: "audio/wav",
        durationMs: out.duration_ms,
        meta: { sample_rate: out.sample_rate, ms: out.ms },
        projectId: project_id,
      });
      return res.json({ item, cached: false, chars: 0, ms: out.ms });
    }

    const spec = MODELS[model];
    if (!spec) throw badRequest(`Unknown model ${model}`);
    if (!voice_id) throw badRequest("Pick a voice.");
    const spoken = translateText(text, model);
    const chunks = chunkText(spoken, spec.maxChars);
    const format = chunks.length > 1 ? "mp3" : req.body.format === "wav" ? "wav" : "mp3";
    const base = { voice_id, model, format };
    if (spec.speed && req.body.speed && Number(req.body.speed) !== 1) base.speed = Number(req.body.speed);
    if (model.startsWith("vox-2") && model !== "vox-2.5" && req.body.delivery && req.body.delivery !== "balanced")
      base.delivery = req.body.delivery;
    if (spec.instruction && req.body.instruction?.trim()) base.instruction = req.body.instruction.trim();
    if (LANGUAGE_MODELS.has(model) && req.body.language) base.language = req.body.language;

    const started = Date.now();
    const parts = [];
    for (const chunk of chunks) parts.push(await synthesize({ ...base, text: chunk }, "speech"));
    const audio = parts.length === 1 ? parts[0].file : Buffer.concat(parts.map((p) => fs.readFileSync(p.file)));
    const billed = parts.filter((p) => !p.cached).reduce((n, p) => n + p.chars, 0);
    // Pressing Generate again on unchanged text replays the cache; reuse its Library item instead of filing a copy.
    const key = parts.map((p) => p.hash).join(",");
    if (!billed) {
      const existing = db
        .prepare("SELECT id FROM library_items WHERE kind = 'speech' AND json_extract(meta, '$.key') = ? ORDER BY id DESC LIMIT 1")
        .get(key);
      if (existing)
        return res.json({ item: getLibraryItem(existing.id), cached: true, chars: 0, chunks: chunks.length, ms: Date.now() - started });
    }
    const item = saveToLibrary({
      kind: "speech",
      title: titleFrom(text),
      text,
      model,
      voice: voice_id,
      data: audio,
      mime: format === "wav" ? "audio/wav" : "audio/mpeg",
      chars: billed,
      meta: { request: { ...base, text: chunks.length > 1 ? `${chunks.length} chunks` : spoken }, chunks: chunks.length, key },
      projectId: project_id,
    });
    res.json({ item, cached: billed === 0, chars: billed, chunks: chunks.length, ms: Date.now() - started });
  }),
);

/** Auto-direct: delivery tags, styles and |overlaps| for a dialogue. Bills no characters. */
playground.post(
  "/podcast/direct",
  wrap(async (req, res) => res.json(await voxJson("/api/v1/tts/direct", { json: req.body, timeout: 120_000 }))),
);

/** Multi-speaker dialogue on Vox 3 (/api/v1/tts/dialogue). */
playground.post(
  "/podcast",
  wrap(async (req, res) => {
    const { model = "vox-3-studio", style, speakers = [], turns = [], format = "mp3", project_id, title } = req.body;
    const clean = turns.filter((t) => t.text?.trim());
    if (!clean.length) throw badRequest("Write at least one line.");
    const body = {
      model,
      ...(style?.trim() ? { style: style.trim() } : {}),
      speakers: speakers.map(({ name, voice_id }) => ({ name, voice_id })),
      turns: clean.map(({ speaker, text, style: s }) => ({ speaker, text: text.trim(), ...(s?.trim() ? { style: s.trim() } : {}) })),
      format,
    };
    const started = Date.now();
    const upstream = await voxFetch("/api/v1/tts/dialogue", { json: body, timeout: 300_000 });
    const audio = Buffer.from(await upstream.arrayBuffer());
    const chars = body.turns.reduce((n, t) => n + t.text.length, 0);
    logUsage("podcast", model, chars);
    const script = body.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
    const item = saveToLibrary({
      kind: "podcast",
      title: title?.trim() || titleFrom(body.turns[0].text, "Podcast"),
      text: script,
      model,
      voice: body.speakers.map((s) => `${s.name}=${s.voice_id}`).join(", "),
      data: audio,
      mime: format === "wav" ? "audio/wav" : "audio/mpeg",
      chars,
      meta: { mode: upstream.headers.get("x-vox-mode"), overlap: upstream.headers.get("x-vox-overlap") === "1", request: body },
      projectId: project_id,
    });
    res.json({ item, chars, mode: item.meta.mode, ms: Date.now() - started });
  }),
);

/**
 * Speech to text. The browser sends the file as the raw body with options in
 * the query. engine "cloud" forwards to /api/v1/transcribe; "local:<id>"
 * expects 16 kHz mono WAV, which the browser converts to first.
 */
playground.post(
  "/transcribe",
  express.raw({ type: () => true, limit: "200mb" }),
  wrap(async (req, res) => {
    const q = req.query;
    const engine = String(q.engine || "cloud");
    const filename = String(q.filename || "audio");
    const mime = String(req.headers["content-type"] || "application/octet-stream");
    if (!req.body?.length) throw badRequest("Choose an audio file.");
    const started = Date.now();
    let result;
    if (engine.startsWith("local:")) {
      result = await runtime.stt(engine.slice(6), req.body, {
        language: q.language || undefined,
        word_timestamps: q.word_timestamps === "true",
      });
    } else {
      if (req.body.length > 15 * 1024 * 1024) throw new VoxError(413, "The VoxTTS API accepts files up to 15 MB.");
      const form = new FormData();
      form.append("audio", new Blob([req.body], { type: mime }), filename);
      for (const k of ["language", "prompts", "word_timestamps", "diarization", "voice_profile"])
        if (q[k]) form.append(k, String(q[k]));
      result = await voxJson("/api/v1/transcribe", { body: form, method: "POST", timeout: 600_000 });
    }
    const item = saveToLibrary({
      kind: "transcript",
      title: titleFrom(result.text || "", filename),
      text: result.text || "",
      engine: engine.startsWith("local:") ? "local" : "cloud",
      model: engine.startsWith("local:") ? engine.slice(6) : "vox-stt-1",
      data: req.body,
      mime,
      durationMs: result.audio_ms ?? null,
      meta: { filename, words: result.words ?? [], language: result.language ?? q.language ?? null, voice_profile: result.voice_profile ?? null },
      projectId: q.project_id,
    });
    res.json({ item, result, ms: Date.now() - started });
  }),
);
