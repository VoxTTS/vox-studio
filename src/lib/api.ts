import type { MasterPlan, Project, ProjectSummary, RenderResult, Settings, Tier, Voice } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || res.statusText, data?.error?.code);
  return data as T;
}

export const api = {
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: { apiKey?: string; baseUrl?: string }) => req<Settings>("PUT", "/api/settings", s),
  testKey: () => req<{ ok: boolean; models?: unknown[] }>("POST", "/api/settings/test"),
  voices: (model: string) => req<{ voices: Voice[] }>("GET", `/api/voices?model=${encodeURIComponent(model)}`),

  projects: () => req<ProjectSummary[]>("GET", "/api/projects"),
  project: (id: number) => req<Project>("GET", `/api/projects/${id}`),
  createProject: (name: string) => req<Project>("POST", "/api/projects", { name }),
  patchProject: (id: number, p: Partial<Pick<Project, "name" | "master_model">>) =>
    req<Project>("PATCH", `/api/projects/${id}`, p),
  deleteProject: (id: number) => req<void>("DELETE", `/api/projects/${id}`),
  arrange: (id: number, segments: { id: number; start_ms: number }[]) =>
    req<Project>("POST", `/api/projects/${id}/arrange`, { segments }),
  masterPlan: (id: number) => req<MasterPlan>("GET", `/api/projects/${id}/master-plan`),

  addTrack: (projectId: number, t: Record<string, unknown> = {}) =>
    req<Project>("POST", `/api/projects/${projectId}/tracks`, t),
  patchTrack: (id: number, t: Record<string, unknown>) => req<Project>("PATCH", `/api/tracks/${id}`, t),
  deleteTrack: (id: number) => req<Project>("DELETE", `/api/tracks/${id}`),

  addSegment: (trackId: number, s: { text?: string; instruction?: string; start_ms: number }) =>
    req<{ id: number; project: Project }>("POST", `/api/tracks/${trackId}/segments`, s),
  patchSegment: (id: number, s: Record<string, unknown>) => req<Project>("PATCH", `/api/segments/${id}`, s),
  deleteSegment: (id: number) => req<Project>("DELETE", `/api/segments/${id}`),
  render: (id: number, tier: Tier) => req<RenderResult>("POST", `/api/segments/${id}/render`, { tier }),

  reportDuration: (hash: string, duration_ms: number) =>
    req<void>("POST", `/api/audio/${hash}/duration`, { duration_ms }),
  cache: () => req<{ files: number; bytes: number; chars: number; saved: number; dir: string }>("GET", "/api/cache"),
  clearCache: () => req<void>("DELETE", "/api/cache"),
};
