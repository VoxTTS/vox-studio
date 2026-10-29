export interface Settings {
  hasKey: boolean;
  keySource: "saved" | "env" | null;
  keyHint: string | null;
  baseUrl: string;
  defaultBaseUrl: string;
  lastCheck: { ok: boolean; at: string; ms?: number; models?: string[]; error?: string } | null;
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  languages?: string[];
  tags?: string[];
  model?: string;
  facets?: Record<string, string[]>;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  color: string;
  archived: boolean;
  updated_at: string;
  counts: { library: number; audiobooks: number; timelines: number };
}

export interface LibraryItem {
  id: number;
  kind: "speech" | "podcast" | "audiobook" | "transcript" | "mixdown" | "upload" | string;
  title: string;
  text: string;
  engine: "cloud" | "local" | string;
  model: string;
  voice: string;
  file: string | null;
  url: string | null;
  mime: string | null;
  bytes: number;
  duration_ms: number | null;
  chars: number;
  meta: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  project_id: number | null;
  created_at: string;
}

export interface Audiobook {
  id: string;
  title: string;
  model: string;
  narrator_voice: string;
  status: "draft" | "rendering" | "stitching" | "ready" | "paused";
  error: string | null;
  characters?: number;
  progress?: { passages: number; done: number; failed: number; pending: number };
  audio_seconds?: number;
  chapters?: { title: string; direction?: string }[];
  files?: Record<string, { bytes: number; url: string }>;
  project_id: number | null;
  created_at?: string;
}

export interface LocalModel {
  id: string;
  repo_id: string;
  source: "hf" | "ms";
  task: "tts" | "stt";
  adapter: string;
  status: "downloading" | "ready" | "error" | "cancelled";
  bytes_total: number;
  bytes_done: number;
  files: string[];
  error: string | null;
  voices: string[];
}

export interface RuntimeStatus {
  python: { command: string; version: string } | null;
  venv: string | null;
  adapters: Record<string, { label: string; tasks: string[]; note: string; installed: boolean }>;
  install: { adapter: string | null; running: boolean; log: string[]; error: string | null; finished: string | null };
  worker: boolean;
}

export interface HubModel {
  id: string;
  downloads: number;
  likes: number;
  task: "tts" | "stt";
  library: string | null;
  tags: string[];
  updated: string | null;
  size?: number | null;
}

export interface Usage {
  byModel: { model: string; month: number; total: number; requests: number }[];
  byKind: { kind: string; chars: number }[];
  cache: { files: number; bytes: number; saved: number; dir: string };
}
