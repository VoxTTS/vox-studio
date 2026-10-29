import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DATA_DIR, db } from "../db.js";
import { VoxError } from "../vox.js";
import { modelDir } from "./hub.js";

// Local inference runs in Python, in a private venv under data/runtime, so
// nothing touches the system Python. Each adapter's packages are installed on
// demand from the Local models tab. One worker process stays up and keeps the
// last couple of models loaded.

const RUNTIME_DIR = path.join(DATA_DIR, "runtime");
const VENV = path.join(RUNTIME_DIR, "venv");
const RUNNER = path.resolve("local-runtime", "runner.py");
const WIN = process.platform === "win32";
const venvPython = path.join(VENV, WIN ? "Scripts/python.exe" : "bin/python");

const TORCH_CPU = process.platform === "darwin" ? [] : ["--index-url", "https://download.pytorch.org/whl/cpu"];

export const ADAPTERS = {
  piper: {
    label: "Piper (ONNX)",
    tasks: ["tts"],
    steps: [["piper-tts"]],
    probe: "piper",
    note: "Fast CPU voices, ~60 MB each. Download a voice folder from rhasspy/piper-voices.",
  },
  "faster-whisper": {
    label: "faster-whisper (CTranslate2)",
    tasks: ["stt"],
    steps: [["faster-whisper"]],
    probe: "faster_whisper",
    note: "Whisper converted for CTranslate2: Systran/faster-whisper-*, *-ct2 repos.",
  },
  transformers: {
    label: "Transformers (PyTorch)",
    tasks: ["tts", "stt"],
    steps: [["torch", ...TORCH_CPU], ["transformers", "numpy", "scipy", "sentencepiece", "accelerate"]],
    probe: "transformers, torch",
    note: "Any model with a transformers text-to-speech or speech-recognition pipeline (MMS-TTS, VITS, Bark, Whisper, wav2vec2…). ~1 GB install.",
  },
  "kokoro-onnx": {
    label: "Kokoro (ONNX)",
    tasks: ["tts"],
    steps: [["kokoro-onnx", "soundfile"]],
    probe: "kokoro_onnx",
    note: "Kokoro-82M without PyTorch: fastrtc/kokoro-onnx (model + voices-v1.0.bin). 50+ voices, many languages.",
  },
  kokoro: {
    label: "Kokoro (PyTorch)",
    tasks: ["tts"],
    steps: [["torch", ...TORCH_CPU], ["kokoro", "soundfile"]],
    probe: "kokoro",
    note: "hexgrad/Kokoro-82M with .pt voice packs. Needs Python 3.10–3.12 (its spaCy dependency has no 3.13 wheels yet).",
  },
};

// ---------- python discovery and installs ----------

let systemPython;
function findPython() {
  if (systemPython !== undefined) return systemPython;
  const candidates = WIN ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  systemPython = null;
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
    const [maj, min] = (r.stdout || "").trim().split(".").map(Number);
    if (r.status === 0 && (maj > 3 || (maj === 3 && min >= 9))) {
      systemPython = { cmd, pre, version: `${maj}.${min}` };
      break;
    }
  }
  return systemPython;
}

const installed = new Map(); // adapter -> boolean
function probe(adapter) {
  if (!fs.existsSync(venvPython)) return false;
  if (installed.has(adapter)) return installed.get(adapter);
  const r = spawnSync(venvPython, ["-c", `import ${ADAPTERS[adapter].probe}`], { encoding: "utf8", timeout: 120_000 });
  installed.set(adapter, r.status === 0);
  return r.status === 0;
}

const install = { adapter: null, running: false, log: [], error: null, finished: null };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    install.log.push(`$ ${path.basename(cmd)} ${args.join(" ")}`);
    const child = spawn(cmd, args, { env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1", PYTHONUNBUFFERED: "1" } });
    const onLine = (line) => {
      install.log.push(line);
      if (install.log.length > 400) install.log.splice(0, install.log.length - 400);
    };
    readline.createInterface({ input: child.stdout }).on("line", onLine);
    readline.createInterface({ input: child.stderr }).on("line", onLine);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

async function doInstall(adapter) {
  const py = findPython();
  if (!py) throw new Error("Python 3.9+ was not found. Install it from python.org and restart Vox Studio.");
  if (!fs.existsSync(venvPython)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    await run(py.cmd, [...py.pre, "-m", "venv", VENV]);
    await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "wheel"]);
  }
  for (const step of ADAPTERS[adapter].steps) await run(venvPython, ["-m", "pip", "install", ...step]);
  installed.delete(adapter);
  if (!probe(adapter)) throw new Error(`Installed, but \`import ${ADAPTERS[adapter].probe}\` still fails. See the log.`);
  worker?.kill(); // pick up the new packages on the next request
}

// ---------- the worker ----------

let worker = null;
const pending = new Map();

function startWorker() {
  const child = spawn(venvPython, [RUNNER], {
    env: { ...process.env, PYTHONUNBUFFERED: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // stray print from a library
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg.result) : p.reject(new VoxError(500, msg.error, "local_runtime"));
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    stderr.push(line);
    if (stderr.length > 60) stderr.shift();
  });
  child.on("close", (code) => {
    if (worker === child) worker = null;
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new VoxError(500, `Local runtime stopped (code ${code}). ${stderr.slice(-6).join(" | ")}`, "local_runtime"));
      pending.delete(id);
    }
  });
  return child;
}

function call(op, args, timeoutMs = 15 * 60_000) {
  if (!fs.existsSync(venvPython)) throw new VoxError(409, "Install the local runtime first (Local models tab).", "runtime_missing");
  worker ??= startWorker();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new VoxError(504, "The local model took too long.", "local_timeout"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(`${JSON.stringify({ id, op, ...args })}\n`);
  });
}

function readyModel(id, task) {
  const row = db.prepare("SELECT * FROM local_models WHERE id = ?").get(id);
  if (!row) throw new VoxError(404, `Local model ${id} is not downloaded.`);
  if (row.status !== "ready") throw new VoxError(409, `${id} is ${row.status}.`);
  if (row.task !== task) throw new VoxError(400, `${id} is a ${row.task.toUpperCase()} model.`);
  if (!ADAPTERS[row.adapter]) throw new VoxError(400, `No runtime can run ${id} yet. Pick a runtime for it in the Local models tab.`);
  if (!probe(row.adapter)) throw new VoxError(409, `Install the ${ADAPTERS[row.adapter].label} runtime first.`, "runtime_missing");
  return row;
}

const tmpFile = (ext) => path.join(os.tmpdir(), `vox-studio-${crypto.randomUUID()}.${ext}`);

export const runtime = {
  status() {
    const py = findPython();
    return {
      python: py ? { command: [py.cmd, ...py.pre].join(" "), version: py.version } : null,
      venv: fs.existsSync(venvPython) ? VENV : null,
      adapters: Object.fromEntries(
        Object.entries(ADAPTERS).map(([k, a]) => [k, { label: a.label, tasks: a.tasks, note: a.note, installed: probe(k) }]),
      ),
      install: { ...install, log: install.log.slice(-200) },
      worker: Boolean(worker),
    };
  },

  install(adapter) {
    if (!ADAPTERS[adapter]) throw new VoxError(400, `Unknown runtime ${adapter}`);
    if (install.running) throw new VoxError(409, `Already installing ${install.adapter}.`);
    Object.assign(install, { adapter, running: true, log: [], error: null, finished: null });
    doInstall(adapter)
      .catch((err) => (install.error = err.message))
      .finally(() => Object.assign(install, { running: false, finished: new Date().toISOString() }));
  },

  async tts(id, { text, voice, speed }) {
    const row = readyModel(id, "tts");
    const out = tmpFile("wav");
    const started = Date.now();
    try {
      const result = await call("tts", {
        adapter: row.adapter,
        path: modelDir(id),
        repo: row.repo_id,
        text,
        voice: voice || null,
        speed: speed ? Number(speed) : null,
        out,
      });
      return { audio: fs.readFileSync(out), ...result, ms: Date.now() - started };
    } finally {
      fs.rmSync(out, { force: true });
    }
  },

  async stt(id, wav, { language, word_timestamps }) {
    const row = readyModel(id, "stt");
    const input = tmpFile("wav");
    fs.writeFileSync(input, wav);
    try {
      return await call("stt", {
        adapter: row.adapter,
        path: modelDir(id),
        repo: row.repo_id,
        audio: input,
        language: language || null,
        word_timestamps: Boolean(word_timestamps),
      });
    } finally {
      fs.rmSync(input, { force: true });
    }
  },

  unload(id) {
    if (worker) void call("unload", { path: modelDir(id) }).catch(() => {});
  },
};
