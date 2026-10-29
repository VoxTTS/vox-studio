import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, db, getSetting } from "./db.js";
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

async function voxFetch(pathname, init = {}) {
  const key = apiKey();
  if (!key) throw new VoxError(401, "No VoxTTS API key saved. Open Settings to add one.", "no_api_key");
  let res;
  try {
    res = await fetch(baseUrl() + pathname, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(120_000),
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

export async function listModels() {
  return (await voxFetch("/api/v1/models")).json();
}

const voiceCache = new Map();
export async function listVoices(model) {
  const catalog = MODELS[model]?.voiceCatalog;
  const key = catalog || "default";
  const hit = voiceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.voices;
  const qs = catalog ? `?model=${encodeURIComponent(catalog)}` : "";
  const { voices = [] } = await (await voxFetch(`/api/v1/voices${qs}`)).json();
  voiceCache.set(key, { at: Date.now(), voices });
  return voices;
}

export function clearVoiceCache() {
  voiceCache.clear();
}

/** The exact /api/v1/tts body a segment produces on a given model. */
export function buildRequest({ segment, track, model }) {
  const spec = MODELS[model];
  if (!spec) throw new VoxError(400, `Unknown model ${model}`);
  const voice_id = spec.tier === "master" ? track.master_voice_id || track.voice_id : track.voice_id;
  const text = translateText(segment.text, model);
  const body = { text, voice_id, model, format: "mp3" };
  const instruction = combineInstruction(track.direction, segment.instruction);
  if (spec.instruction && instruction) body.instruction = instruction;
  return body;
}

/**
 * Cache key: the request that would be sent — so the spoken text, voice and
 * model, plus the instruction (a different emotion is different audio).
 * Editing one segment never invalidates another's audio.
 */
export function hashRequest(body) {
  const canonical = JSON.stringify([body.text, body.voice_id, body.model, body.instruction || "", body.format]);
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function cachePath(hash) {
  if (!/^[0-9a-f]{32}$/.test(hash)) throw new VoxError(400, "Bad audio id");
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

export function isCached(hash) {
  return fs.existsSync(cachePath(hash));
}

/** Render one request, served from disk when the same request was rendered before. */
export async function synthesize(body) {
  const hash = hashRequest(body);
  const file = cachePath(hash);
  if (fs.existsSync(file)) {
    db.prepare("UPDATE audio_cache SET hits = hits + 1 WHERE hash = ?").run(hash);
    return { hash, cached: true, chars: body.text.length };
  }
  if (!body.text) throw new VoxError(400, "Segment has no speakable text.");
  const max = MODELS[body.model].maxChars;
  if (body.text.length > max)
    throw new VoxError(400, `${MODELS[body.model].label} accepts up to ${max} characters per segment (this one has ${body.text.length}). Split it.`);

  const res = await voxFetch("/api/v1/tts", { method: "POST", body: JSON.stringify(body) });
  const audio = Buffer.from(await res.arrayBuffer());
  // Write to a temp name and rename so a crash never leaves a half file in the cache.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, audio);
  fs.renameSync(tmp, file);
  db.prepare(
    `INSERT INTO audio_cache (hash, model, voice_id, chars, bytes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET bytes = excluded.bytes`,
  ).run(hash, body.model, body.voice_id, body.text.length, audio.length);
  return { hash, cached: false, chars: body.text.length };
}
