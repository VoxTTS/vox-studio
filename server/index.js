import fs from "node:fs";
import path from "node:path";
import express from "express";
import { CACHE_DIR, DATA_DIR, db, seedDemoTimeline } from "./db.js";
import { notFound } from "./http.js";
import { account } from "./routes/account.js";
import { audiobooks } from "./routes/audiobooks.js";
import { library } from "./routes/library.js";
import { local } from "./routes/local.js";
import { playground } from "./routes/playground.js";
import { timelines } from "./routes/timelines.js";
import { voices } from "./routes/voices.js";
import { VoxError } from "./vox.js";
import { ALL_MODELS, MASTER_MODELS, MODELS, PREVIEW_MODEL } from "../shared/directives.js";

const PORT = Number(process.env.PORT) || 3000;
// Local-first: only this machine can reach the server (and the saved key).
const HOST = process.env.HOST || "127.0.0.1";
const DEV = process.argv.includes("--dev");

seedDemoTimeline();

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/api/models", (_req, res) => res.json({ models: MODELS, all: ALL_MODELS, preview: PREVIEW_MODEL, master: MASTER_MODELS }));

app.get("/api/cache", (_req, res) => {
  const row = db
    .prepare("SELECT COUNT(*) files, COALESCE(SUM(bytes),0) bytes, COALESCE(SUM(chars),0) chars, COALESCE(SUM(chars*hits),0) saved FROM audio_cache")
    .get();
  res.json({ ...row, dir: CACHE_DIR });
});

app.delete("/api/cache", (_req, res) => {
  for (const f of fs.readdirSync(CACHE_DIR)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
  db.prepare("DELETE FROM audio_cache").run();
  res.status(204).end();
});

for (const router of [account, voices, playground, audiobooks, library, timelines, local]) app.use("/api", router);
app.use("/api", (_req, _res, next) => next(notFound("Route")));

// ---------- frontend ----------

const distDir = path.resolve("dist");
if (DEV) {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
} else if (fs.existsSync(path.join(distDir, "index.html"))) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
} else {
  app.get("/", (_req, res) => res.status(503).send("Frontend not built. Run `npm run build` (or `npm run dev`)."));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
  if (status >= 500 && !(err instanceof VoxError)) console.error(err);
  res.status(status).json({ error: { message: err.message, code: err.code } });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  VoxTTS Studio running at http://localhost:${PORT}${DEV ? " (dev)" : ""}`);
  console.log(`  Data: ${DATA_DIR}\n`);
});
