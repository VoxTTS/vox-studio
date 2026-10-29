import { req } from "@/lib/api";
import type { MasterPlan, RenderResult, Tier, Timeline, TimelineSummary } from "./types";

export const editorApi = {
  timelines: () => req<TimelineSummary[]>("GET", "/api/timelines"),
  timeline: (id: number) => req<Timeline>("GET", `/api/timelines/${id}`),
  createTimeline: (name: string, project_id: number | null) => req<Timeline>("POST", "/api/timelines", { name, project_id }),
  patchTimeline: (id: number, p: Partial<Pick<Timeline, "name" | "master_model" | "project_id">>) =>
    req<Timeline>("PATCH", `/api/timelines/${id}`, p),
  deleteTimeline: (id: number) => req<void>("DELETE", `/api/timelines/${id}`),
  arrange: (id: number, segments: { id: number; start_ms: number }[]) =>
    req<Timeline>("POST", `/api/timelines/${id}/arrange`, { segments }),
  masterPlan: (id: number) => req<MasterPlan>("GET", `/api/timelines/${id}/master-plan`),

  addTrack: (timelineId: number, t: Record<string, unknown> = {}) => req<Timeline>("POST", `/api/timelines/${timelineId}/tracks`, t),
  patchTrack: (id: number, t: Record<string, unknown>) => req<Timeline>("PATCH", `/api/tracks/${id}`, t),
  deleteTrack: (id: number) => req<Timeline>("DELETE", `/api/tracks/${id}`),

  addSegment: (trackId: number, s: { text?: string; instruction?: string; start_ms: number }) =>
    req<{ id: number; timeline: Timeline }>("POST", `/api/tracks/${trackId}/segments`, s),
  patchSegment: (id: number, s: Record<string, unknown>) => req<Timeline>("PATCH", `/api/segments/${id}`, s),
  deleteSegment: (id: number) => req<Timeline>("DELETE", `/api/segments/${id}`),
  render: (id: number, tier: Tier) => req<RenderResult>("POST", `/api/segments/${id}/render`, { tier }),
  reportDuration: (hash: string, duration_ms: number) => req<void>("POST", `/api/audio/${hash}/duration`, { duration_ms }),
};
