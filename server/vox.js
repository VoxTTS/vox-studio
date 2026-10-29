import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, db, getSetting, logUsage } from "./db.js";
import { MODELS, combineInstruction, translateText } from "../shared/directives.js";

export const DEFAULT_BASE_URL = "https://voxtts.app";

export class VoxError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiKey() {
  return getSetting("voxtts_api_key") || process.env.VOXTTS_API_KEY || null;
}

export function baseUrl() {
  return (getSetting("voxtts_base_url") || process.env.VOXTTS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Authenticated request to the VoxTTS API; throws VoxError with the API's own message on failure. */
export async function voxFetch(pathname, init = {}) {
  const key = apiKey();
  if (!key) throw new VoxError(401, "No VoxTTS API key saved. Open the API key tab to add one.", "no_api_key");
  const json = init.json !== undefined;
  let res;
  try {
    res = await fetch(baseUrl() + pathname, {
      method: init.method || (json || init.body ? "POST" : "GET"),
      body: json ? JSON.stringify(init.json) : init.body,
      redirect: init.redirect || "follow",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(init.timeout ?? 180_000),
    });
  } catch (err) {
    throw new VoxError(502, `Could not reach ${baseUrl()}: ${err.message}`, "network");
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code;
    try {
      const body = await res.json();
      message = body.error?.message || body.message || body.error || message;
      code = body.error?.code || body.code;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    if (typeof message !== "string") message = JSON.stringify(message);
    throw new VoxError(res.status, message, code);
  }
  return res;
}

export async function voxJson(pathname, init) {
  const res = await voxFetch(pathname, init);
  return res.status === 204 ? {} : res.json();
}

export async function listModels() {
  return voxJson("/api/v1/models");
}

const voiceCache = new Map();
/** Voice catalogue for a model (models that share a catalogue share one cached list). */
export async function listVoices(model) {
  const catalog = MODELS[model]?.catalog || "vox-2";
  const hit = voiceCache.get(catalog);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.voices;
  const { voices = [] } = await voxJson(`/api/v1/voices?model=${encodeURIComponent(catalog)}`);
  voiceCache.set(catalog, { at: Date.now(), voices });
  return voices;
}

export function clearVoiceCache() {
  voiceCache.clear();
}

/** The exact /api/v1/tts body an editor segment produces on a given model. */
export function buildRequest({ segment, track, model }) {
  const spec = MODELS[model];
  if (!spec) throw new VoxError(400, `Unknown model ${model}`);
  const voice_id = spec.tier === "master" ? track.master_voice_id || track.voice_id : track.voice_id;
  const body = { text: translateText(segment.text, model), voice_id, model, format: "mp3" };
  const instruction = combineInstruction(track.direction, segment.instruction);
  if (spec.instruction && instruction) body.instruction = instruction;
  return body;
}

/**
 * Cache key: everything in the request that changes the audio — text, voice,
 * model, instruction, format and the optional knobs. Editing one segment
 * never invalidates another's audio, and a changed emotion is a new render.
 */
export function hashRequest(body) {
  const canonical = JSON.stringify([
    body.text,
    body.voice_id,
    body.model,
    body.instruction || "",
    body.format || "mp3",
    body.speed ?? null,
    body.delivery ?? null,
    body.language ?? null,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function cachePath(hash, format = "mp3") {
  if (!/^[0-9a-f]{32}$/.test(hash)) throw new VoxError(400, "Bad audio id");
  return path.join(CACHE_DIR, `${hash}.${format === "mp3" ? "mp3" : format}`);
}

export function isCached(hash) {
  return fs.existsSync(cachePath(hash));
}

/** Render one /api/v1/tts request, served from disk when the same request was rendered before. */
export async function synthesize(body, kind = "speech") {
  const hash = hashRequest(body);
  const file = cachePath(hash, body.format);
  if (fs.existsSync(file)) {
    db.prepare("UPDATE audio_cache SET hits = hits + 1 WHERE hash = ?").run(hash);
    return { hash, file, cached: true, chars: body.text.length };
  }
  if (!body.text) throw new VoxError(400, "There is no speakable text.");
  const spec = MODELS[body.model];
  if (spec && body.text.length > spec.maxChars)
    throw new VoxError(
      400,
      `${spec.label} accepts up to ${spec.maxChars} characters per request (this one has ${body.text.length}).`,
    );

  const res = await voxFetch("/api/v1/tts", { json: body });
  const audio = Buffer.from(await res.arrayBuffer());
  // Write to a temp name and rename so a crash never leaves a half file in the cache.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, audio);
  fs.renameSync(tmp, file);
  db.prepare(
    `INSERT INTO audio_cache (hash, model, voice_id, chars, bytes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET bytes = excluded.bytes`,
  ).run(hash, body.model, body.voice_id, body.text.length, audio.length);
  logUsage(kind, body.model, body.text.length);
  return { hash, file, cached: false, chars: body.text.length };
}
