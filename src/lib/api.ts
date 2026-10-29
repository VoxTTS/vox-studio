import type { Audiobook, HubModel, LibraryItem, LocalModel, Project, RuntimeStatus, Settings, Usage, Voice } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function req<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const raw = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(url, {
    method,
    headers: raw ? headers : body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: raw ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || res.statusText, data?.error?.code);
  return data as T;
}

const qs = (o: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const api = {
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: { apiKey?: string; baseUrl?: string }) => req<Settings>("PUT", "/api/settings", s),
  testKey: () => req<{ ok: boolean; ms: number; models: string[]; details: { id: string; name: string; description: string; latency?: string }[] }>("POST", "/api/settings/test"),
  usage: () => req<Usage>("GET", "/api/usage"),
  clearCache: () => req<void>("DELETE", "/api/cache"),

  voices: (model: string) => req<{ voices: Voice[]; catalog: string }>("GET", `/api/voices?model=${encodeURIComponent(model)}`),
  previewVoice: (model: string, voice_id: string, language?: string) =>
    req<{ url: string; cached: boolean; chars: number }>("POST", "/api/voices/preview", { model, voice_id, language }),
  designVoice: (b: { prompt: string; preview_text?: string; samples: number; language?: string }) =>
    req<{ preview_text: string; language: string | null; candidates: { draft_id: string; audio_base64: string; content_type: string }[] }>("POST", "/api/voices/design", b),
  publishVoice: (b: { draft_id: string; name: string; prompt: string; language?: string }) =>
    req<{ voice: Voice }>("POST", "/api/voices/design/publish", b),
  renameVoice: (id: string, b: { name?: string; description?: string }) => req<unknown>("PATCH", `/api/voices/${encodeURIComponent(id)}`, b),
  deleteVoice: (id: string) => req<void>("DELETE", `/api/voices/${encodeURIComponent(id)}`),

  speech: (b: Record<string, unknown>) => req<{ item: LibraryItem; cached: boolean; chars: number; ms: number; chunks?: number }>("POST", "/api/speech", b),
  podcast: (b: Record<string, unknown>) => req<{ item: LibraryItem; chars: number; mode: string; ms: number }>("POST", "/api/podcast", b),
  direct: (b: Record<string, unknown>) =>
    req<{ style?: string; turns: { speaker: string; text: string; style?: string; directed?: boolean }[] }>("POST", "/api/podcast/direct", b),
  transcribe: (file: Blob, opts: Record<string, unknown>) =>
    req<{ item: LibraryItem; result: { text: string; words: { word: string; start_ms: number; end_ms: number; speaker?: number | null }[]; language?: string; audio_ms?: number }; ms: number }>(
      "POST",
      `/api/transcribe?${qs(opts)}`,
      file,
      { "Content-Type": file.type || "application/octet-stream" },
    ),

  audiobooks: (project?: string) => req<{ audiobooks: Audiobook[] }>("GET", `/api/audiobooks?${qs({ project })}`),
  audiobook: (id: string) => req<{ audiobook: Audiobook }>("GET", `/api/audiobooks/${id}`),
  createAudiobook: (b: Record<string, unknown>) => req<{ audiobook: Audiobook; rendering_started?: boolean }>("POST", "/api/audiobooks", b),
  renderAudiobook: (id: string) => req<unknown>("POST", `/api/audiobooks/${id}/render`, {}),
  cancelAudiobook: (id: string) => req<unknown>("POST", `/api/audiobooks/${id}/cancel`, {}),
  deleteAudiobook: (id: string) => req<void>("DELETE", `/api/audiobooks/${id}`),
  saveAudiobook: (id: string, format: string) => req<{ item: LibraryItem }>("POST", `/api/audiobooks/${id}/save`, { format }),

  library: (o: { project?: string; kind?: string; q?: string }) => req<{ items: LibraryItem[] }>("GET", `/api/library?${qs(o)}`),
  patchLibrary: (id: number, b: { title?: string; project_id?: number | null }) => req<{ item: LibraryItem }>("PATCH", `/api/library/${id}`, b),
  deleteLibrary: (id: number) => req<void>("DELETE", `/api/library/${id}`),
  uploadLibrary: (blob: Blob, o: Record<string, unknown>) =>
    req<{ item: LibraryItem }>("POST", `/api/library/upload?${qs(o)}`, blob, { "Content-Type": blob.type }),

  projects: () => req<{ projects: Project[] }>("GET", "/api/projects"),
  createProject: (b: { name: string; description?: string; color?: string }) => req<{ project: Project }>("POST", "/api/projects", b),
  patchProject: (id: number, b: Partial<Pick<Project, "name" | "description" | "color" | "archived">>) =>
    req<{ project: Project }>("PATCH", `/api/projects/${id}`, b),
  deleteProject: (id: number, contents: "unfile" | "delete") => req<void>("DELETE", `/api/projects/${id}?contents=${contents}`),
  move: (project_id: number | null, items: { library?: number[]; audiobooks?: string[]; timelines?: number[] }) =>
    req<{ ok: boolean }>("POST", "/api/projects/move", { project_id, items }),

  runtime: () => req<RuntimeStatus>("GET", "/api/local/runtime"),
  installRuntime: (adapter: string) => req<RuntimeStatus>("POST", "/api/local/runtime/install", { adapter }),
  hub: () => req<{ hfEndpoint: string; msEndpoint: string; hasHfToken: boolean }>("GET", "/api/local/hub"),
  saveHub: (b: { hfToken?: string; hfEndpoint?: string; msEndpoint?: string }) =>
    req<{ hfEndpoint: string; msEndpoint: string; hasHfToken: boolean }>("PUT", "/api/local/hub", b),
  searchHub: (o: { q: string; task: string; source: string }) =>
    req<{ source: "hf" | "ms"; models: HubModel[]; fallback?: string }>("GET", `/api/local/search?${qs(o)}`),
  repoFiles: (o: { repo: string; source: string; task?: string }) =>
    req<{ source: "hf" | "ms"; repo: string; files: { path: string; size: number }[]; suggested: string[]; detected: { adapter: string; task: "tts" | "stt" }; fallback?: string }>(
      "GET",
      `/api/local/files?${qs(o)}`,
    ),
  localModels: () => req<{ models: LocalModel[] }>("GET", "/api/local/models"),
  downloadModel: (b: { repo: string; source: string; paths: string[]; task?: string; adapter?: string; name?: string }) =>
    req<{ model: LocalModel }>("POST", "/api/local/models", b),
  patchModel: (id: string, b: { adapter?: string; task?: string }) => req<{ model: LocalModel }>("PATCH", `/api/local/models/${id}`, b),
  cancelModel: (id: string) => req<unknown>("POST", `/api/local/models/${id}/cancel`),
  deleteModel: (id: string) => req<void>("DELETE", `/api/local/models/${id}`),
};
