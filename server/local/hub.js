import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODELS_DIR, db, getSetting } from "../db.js";
import { VoxError } from "../vox.js";

// Model hubs. Hugging Face is the primary source; ModelScope mirrors most
// popular speech repos (often under the same id, sometimes under
// AI-ModelScope/ or openai-mirror/) and is used when HF is unreachable,
// rate-limited, or when the user picks it.

export function hfEndpoint() {
  return (getSetting("hf_endpoint") || process.env.HF_ENDPOINT || "https://huggingface.co").replace(/\/+$/, "");
}
export function msEndpoint() {
  return (getSetting("ms_endpoint") || process.env.MODELSCOPE_ENDPOINT || "https://www.modelscope.cn").replace(/\/+$/, "");
}
function hfHeaders() {
  const token = getSetting("hf_token") || process.env.HF_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const HF_TASK = { tts: "text-to-speech", stt: "automatic-speech-recognition" };
const MS_TASK = { tts: "text-to-speech", stt: "auto-speech-recognition" };

async function getJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new VoxError(502, `${new URL(url).host}: ${err.message}`, "network");
  }
  if (!res.ok) throw new VoxError(res.status === 404 ? 404 : 502, `${new URL(url).host} answered ${res.status}`, `hub_${res.status}`);
  return res.json();
}

/** Search one hub, or Hugging Face with ModelScope as the fallback ("auto"). */
export async function searchModels({ q = "", task = "tts", source = "auto" }) {
  const errors = [];
  if (source !== "ms") {
    try {
      const url = new URL(`${hfEndpoint()}/api/models`);
      if (q) url.searchParams.set("search", q);
      url.searchParams.set("pipeline_tag", HF_TASK[task]);
      url.searchParams.set("sort", "downloads");
      url.searchParams.set("limit", "40");
      const rows = await getJson(url, hfHeaders());
      return {
        source: "hf",
        models: rows.map((m) => ({
          id: m.id,
          downloads: m.downloads ?? 0,
          likes: m.likes ?? 0,
          task,
          library: m.library_name ?? m.tags?.find((t) => !t.includes(":")) ?? null,
          tags: (m.tags ?? []).filter((t) => !t.startsWith("arxiv:") && !t.startsWith("doi:")).slice(0, 8),
          updated: m.lastModified ?? m.createdAt ?? null,
        })),
      };
    } catch (err) {
      errors.push(`Hugging Face: ${err.message}`);
      if (source === "hf") throw err;
    }
  }
  try {
    const url = new URL(`${msEndpoint()}/openapi/v1/models`);
    url.searchParams.set("search", q || (task === "tts" ? "tts" : "asr"));
    url.searchParams.set("page_size", "50");
    const out = await getJson(url);
    const models = (out.data?.models ?? [])
      .filter((m) => !m.tasks?.length || m.tasks.includes(MS_TASK[task]))
      .map((m) => ({
        id: m.id,
        downloads: m.downloads ?? 0,
        likes: m.likes ?? 0,
        task,
        library: m.tags?.find((t) => t.startsWith("library:"))?.slice(8) ?? null,
        tags: (m.tags ?? []).filter((t) => !t.startsWith("custom_tag")).slice(0, 8),
        updated: m.last_modified ?? null,
        size: m.file_size ?? null,
      }));
    return { source: "ms", models, fallback: errors[0] };
  } catch (err) {
    errors.push(`ModelScope: ${err.message}`);
    throw new VoxError(502, errors.join(" · "), "hub_unreachable");
  }
}

async function hfFiles(repo) {
  // The tree API pages large repos (rhasspy/piper-voices has thousands of files) via a Link header.
  const files = [];
  let url = `${hfEndpoint()}/api/models/${repo}/tree/main?recursive=true`;
  for (let page = 0; url && page < 50; page++) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", ...hfHeaders() }, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new VoxError(502, `${new URL(url).host}: ${err.message}`, "network");
    }
    if (!res.ok) throw new VoxError(res.status === 404 ? 404 : 502, `Hugging Face answered ${res.status}`, `hub_${res.status}`);
    for (const f of await res.json())
      if (f.type === "file") files.push({ path: f.path, size: f.lfs?.size ?? f.size ?? 0 });
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") || "")?.[1] ?? null;
  }
  return files;
}

async function msFiles(repo) {
  const out = await getJson(`${msEndpoint()}/api/v1/models/${repo}/repo/files?Revision=master&Recursive=true`);
  if (out.Code !== 200 || !out.Data) throw new VoxError(404, `ModelScope has no ${repo}`, "hub_404");
  return out.Data.Files.filter((f) => f.Type === "blob").map((f) => ({ path: f.Path, size: f.Size ?? 0 }));
}

/** Ids a Hugging Face repo is commonly mirrored under on ModelScope. */
export function msCandidates(repo) {
  const [owner, name] = repo.split("/");
  const out = [repo, `AI-ModelScope/${name}`];
  if (owner === "openai") out.push(`openai-mirror/${name}`);
  if (owner === "facebook") out.push(`facebook-mirror/${name}`);
  return [...new Set(out)];
}

/** The repo's files from the first source that answers. */
export async function listFiles(repo, source = "auto") {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new VoxError(400, "Use an owner/name repo id, e.g. rhasspy/piper-voices.");
  const errors = [];
  if (source !== "ms") {
    try {
      return { source: "hf", repo, files: await hfFiles(repo) };
    } catch (err) {
      errors.push(`Hugging Face: ${err.message}`);
      if (source === "hf") throw err;
    }
  }
  for (const candidate of msCandidates(repo)) {
    try {
      return { source: "ms", repo: candidate, files: await msFiles(candidate), fallback: errors[0] };
    } catch (err) {
      if (candidate === repo) errors.push(`ModelScope: ${err.message}`);
    }
  }
  throw new VoxError(404, `Could not list ${repo}. ${errors.join(" · ")}`, "hub_404");
}

// ---------- what to download, and what can run it ----------

const SKIP = [
  /(^|\/)\.gitattributes$/,
  /\.(png|jpe?g|gif|webp|svg|mp4|mp3|wav|flac|ogg|ipynb)$/i,
  /(^|\/)(samples?|eval|examples?|demo|assets|images|docs?)\//i,
  /\.(msgpack|h5|ot|tflite|mlmodel|gguf)$/i,
  /(^|\/)(flax_model|tf_model|rust_model)/i,
];

/** Default selection: the files a runtime needs, minus samples and other frameworks' weights. */
export function suggestFiles(files) {
  let keep = files.filter((f) => !SKIP.some((re) => re.test(f.path)));
  const has = (re) => keep.some((f) => re.test(f.path));
  // One weight format is enough: prefer safetensors over .bin, skip ONNX exports
  // of transformer repos (Piper voices are ONNX-only and stay).
  if (has(/\.safetensors$/)) keep = keep.filter((f) => !/pytorch_model.*\.bin$/.test(f.path));
  if (has(/(^|\/)config\.json$/) && has(/\.(safetensors|bin|pth)$/)) keep = keep.filter((f) => !/(^|\/)onnx\//.test(f.path));
  return keep.map((f) => f.path);
}

/** Pick the runtime that can execute a set of files. The user can override it. */
export function detectAdapter(repo, paths, task) {
  const has = (re) => paths.some((p) => re.test(p));
  if (has(/\.onnx$/) && has(/\.onnx\.json$/)) return { adapter: "piper", task: "tts" };
  if (has(/\.onnx$/) && has(/voices[^/]*\.bin$/)) return { adapter: "kokoro-onnx", task: "tts" };
  if (/kokoro/i.test(repo) && has(/\.pth$/)) return { adapter: "kokoro", task: "tts" };
  if (has(/(^|\/)model\.bin$/) && !has(/\.safetensors$|pytorch_model/) && (/whisper|ct2|ctranslate/i.test(repo) || has(/vocabulary\.(json|txt)$/)))
    return { adapter: "faster-whisper", task: "stt" };
  if (has(/(^|\/)config\.json$/) && has(/\.(safetensors|bin)$/)) {
    const stt = task ? task === "stt" : /whisper|wav2vec|hubert|asr|speech-recognition|parakeet|canary|moonshine/i.test(repo);
    return { adapter: "transformers", task: stt ? "stt" : "tts" };
  }
  return { adapter: "unsupported", task: task || "tts" };
}

// ---------- downloads ----------

const jobs = new Map(); // id -> AbortController

export function modelDir(id) {
  return path.join(MODELS_DIR, id);
}

function slug(s) {
  return s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function fileUrl(source, repo, file) {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  return source === "hf"
    ? `${hfEndpoint()}/${repo}/resolve/main/${encoded}`
    : `${msEndpoint()}/models/${repo}/resolve/master/${encoded}`;
}

/**
 * Start downloading `paths` of `repo` in the background. Each file is tried on
 * the chosen source, then on the other hub, three attempts in all.
 */
export function startDownload({ repo, requested = repo, source, files, paths, task, adapter, name }) {
  const chosen = files.filter((f) => paths.includes(f.path));
  if (!chosen.length) throw new VoxError(400, "Select at least one file.");
  const detected = detectAdapter(repo, paths, task);
  // Named after the repo the user asked for, even when a ModelScope mirror serves it.
  // A Piper repo holds many voices, so its downloads are named after the voice.
  const onnx = chosen.find((f) => f.path.endsWith(".onnx"));
  const piper = (adapter || detected.adapter) === "piper" && onnx;
  const id = slug(name || (piper ? `${requested}-${path.basename(onnx.path, ".onnx")}` : requested).replace("/", "--"));
  if (jobs.has(id)) throw new VoxError(409, `${id} is already downloading.`);
  const total = chosen.reduce((n, f) => n + (f.size || 0), 0);
  db.prepare(
    `INSERT INTO local_models (id, repo_id, source, task, adapter, status, bytes_total, bytes_done, files, error)
     VALUES (?, ?, ?, ?, ?, 'downloading', ?, 0, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET repo_id = excluded.repo_id, source = excluded.source, task = excluded.task,
       adapter = excluded.adapter, status = 'downloading', bytes_total = excluded.bytes_total, bytes_done = 0,
       files = excluded.files, error = NULL`,
  ).run(id, requested, source, task || detected.task, adapter || detected.adapter, total, JSON.stringify(chosen.map((f) => f.path)));

  const ac = new AbortController();
  jobs.set(id, ac);
  void runDownload(id, repo, source, chosen, ac.signal).finally(() => jobs.delete(id));
  return id;
}

async function runDownload(id, repo, source, files, signal) {
  const dir = modelDir(id);
  fs.mkdirSync(dir, { recursive: true });
  let done = 0;
  let lastWrite = 0;
  const progress = (force = false) => {
    if (!force && Date.now() - lastWrite < 500) return;
    lastWrite = Date.now();
    db.prepare("UPDATE local_models SET bytes_done = ? WHERE id = ?").run(done, id);
  };
  // The other hub, for per-file fallback.
  let alt = null;
  const altFor = async () => {
    if (alt !== null) return alt;
    if (source === "ms") alt = { source: "hf", repo: repo.replace(/^(AI-ModelScope|openai-mirror|facebook-mirror)\//, "") };
    else {
      alt = false;
      for (const c of msCandidates(repo))
        try {
          await msFiles(c);
          alt = { source: "ms", repo: c };
          break;
        } catch {
          // try the next candidate
        }
    }
    return alt;
  };

  try {
    for (const f of files) {
      const dest = path.join(dir, f.path);
      if (!dest.startsWith(dir + path.sep)) throw new Error(`Refusing path ${f.path}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest) && f.size && fs.statSync(dest).size === f.size) {
        done += f.size;
        progress();
        continue;
      }
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const where = attempt === 0 ? { source, repo } : (await altFor()) || { source, repo };
        const before = done;
        try {
          const res = await fetch(fileUrl(where.source, where.repo, f.path), {
            headers: where.source === "hf" ? hfHeaders() : {},
            redirect: "follow",
            signal,
          });
          if (!res.ok || !res.body) throw new Error(`${where.source === "hf" ? "Hugging Face" : "ModelScope"} answered ${res.status} for ${f.path}`);
          const tmp = `${dest}.part`;
          const counter = new TransformStream({
            transform(chunk, ctl) {
              done += chunk.byteLength;
              progress();
              ctl.enqueue(chunk);
            },
          });
          await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(tmp));
          fs.renameSync(tmp, dest);
          lastErr = null;
          break;
        } catch (err) {
          if (signal.aborted) throw err;
          done = before;
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      if (lastErr) throw lastErr;
    }
    progress(true);
    db.prepare("UPDATE local_models SET status = 'ready', bytes_total = MAX(bytes_total, bytes_done) WHERE id = ?").run(id);
  } catch (err) {
    db.prepare("UPDATE local_models SET status = ?, error = ? WHERE id = ?").run(
      signal.aborted ? "cancelled" : "error",
      signal.aborted ? "Cancelled" : err.message,
      id,
    );
  }
}

export function cancelDownload(id) {
  jobs.get(id)?.abort();
}

export function removeModel(id) {
  cancelDownload(id);
  fs.rmSync(modelDir(id), { recursive: true, force: true });
  db.prepare("DELETE FROM local_models WHERE id = ?").run(id);
}

/** Speakers/voices a downloaded model offers (Piper speaker maps, Kokoro voice packs). */
export function modelVoices(row) {
  const dir = modelDir(row.id);
  const files = JSON.parse(row.files);
  if (row.adapter === "piper") {
    const cfg = files.find((f) => f.endsWith(".onnx.json"));
    try {
      const map = JSON.parse(fs.readFileSync(path.join(dir, cfg), "utf8")).speaker_id_map ?? {};
      return Object.keys(map);
    } catch {
      return [];
    }
  }
  if (row.adapter === "kokoro") return files.filter((f) => /^voices\/.+\.pt$/.test(f)).map((f) => path.basename(f, ".pt"));
  if (row.adapter === "kokoro-onnx") {
    // voices-v1.0.bin is a NumPy .npz (a zip); the voice names are its entry names, listed at the end of the file.
    const bin = files.find((f) => /voices[^/]*\.bin$/.test(f));
    try {
      const file = path.join(dir, bin);
      const size = fs.statSync(file).size;
      const tail = Buffer.alloc(Math.min(size, 65536));
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, tail, 0, tail.length, size - tail.length);
      fs.closeSync(fd);
      return [...new Set([...tail.toString("latin1").matchAll(/([a-z]{2}_[a-z]+)\.npy/g)].map((m) => m[1]))].sort();
    } catch {
      return [];
    }
  }
  return [];
}

// Downloads interrupted by a restart are marked so the UI can offer a retry.
db.prepare("UPDATE local_models SET status = 'error', error = 'Interrupted — download again to resume' WHERE status = 'downloading'").run();
