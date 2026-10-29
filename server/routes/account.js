import { Router } from "express";
import { CACHE_DIR, db, getSetting, setSetting } from "../db.js";
import { wrap } from "../http.js";
import { DEFAULT_BASE_URL, VoxError, apiKey, baseUrl, clearVoiceCache, listModels } from "../vox.js";

export const account = Router();

function settingsView() {
  const key = apiKey();
  return {
    hasKey: Boolean(key),
    keySource: getSetting("voxtts_api_key") ? "saved" : key ? "env" : null,
    keyHint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null,
    baseUrl: baseUrl(),
    defaultBaseUrl: DEFAULT_BASE_URL,
    lastCheck: JSON.parse(getSetting("last_key_check") || "null"),
  };
}

account.get("/settings", (_req, res) => res.json(settingsView()));

account.put("/settings", (req, res) => {
  const { apiKey: key, baseUrl: url } = req.body;
  if (key !== undefined) {
    const trimmed = String(key).trim();
    if (trimmed && !/^vox_sk_\w{8,}$/.test(trimmed))
      throw new VoxError(400, "That does not look like a VoxTTS key (they start with vox_sk_).");
    setSetting("voxtts_api_key", trimmed);
    setSetting("last_key_check", "");
  }
  if (url !== undefined) {
    const trimmed = String(url).trim().replace(/\/+$/, "");
    if (trimmed && !/^https?:\/\//.test(trimmed)) throw new VoxError(400, "Base URL must start with http(s)://");
    setSetting("voxtts_base_url", trimmed === DEFAULT_BASE_URL ? "" : trimmed);
  }
  clearVoiceCache();
  res.json(settingsView());
});

// GET /api/v1/models costs no quota, so it is the safe way to check a key.
account.post(
  "/settings/test",
  wrap(async (_req, res) => {
    const started = Date.now();
    try {
      const { models = [] } = await listModels();
      const check = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, models: models.map((m) => m.id) };
      setSetting("last_key_check", JSON.stringify(check));
      res.json({ ...check, details: models });
    } catch (err) {
      setSetting("last_key_check", JSON.stringify({ ok: false, at: new Date().toISOString(), error: err.message }));
      throw err;
    }
  }),
);

/** What this app has spent through the key, and what the render cache saved. */
account.get("/usage", (_req, res) => {
  const byModel = db
    .prepare(
      `SELECT model,
              SUM(CASE WHEN created_at >= date('now','start of month') THEN chars ELSE 0 END) AS month,
              SUM(chars) AS total,
              COUNT(*) AS requests
       FROM usage_log GROUP BY model ORDER BY total DESC`,
    )
    .all();
  const byKind = db
    .prepare(
      `SELECT kind, SUM(chars) AS chars FROM usage_log
       WHERE created_at >= date('now','start of month') GROUP BY kind ORDER BY chars DESC`,
    )
    .all();
  const cache = db
    .prepare(
      "SELECT COUNT(*) files, COALESCE(SUM(bytes),0) bytes, COALESCE(SUM(chars*hits),0) saved FROM audio_cache",
    )
    .get();
  res.json({ byModel, byKind, cache: { ...cache, dir: CACHE_DIR } });
});
