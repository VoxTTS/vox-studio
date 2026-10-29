export type Tier = "preview" | "master";

export interface Track {
  id: number;
  project_id: number;
  name: string;
  color: string;
  voice_id: string;
  master_voice_id: string;
  direction: string;
  position: number;
  muted: number;
  solo: number;
  gain: number;
}

export interface Segment {
  id: number;
  track_id: number;
  text: string;
  instruction: string;
  start_ms: number;
  preview_hash: string;
  preview_ready: boolean;
  preview_chars: number;
  preview_duration_ms: number | null;
  master_hash: string;
  master_ready: boolean;
  master_chars: number;
  master_duration_ms: number | null;
}

export interface Project {
  id: number;
  name: string;
  master_model: string;
  updated_at: string;
  tracks: Track[];
  segments: Segment[];
}

export interface ProjectSummary {
  id: number;
  name: string;
  updated_at: string;
  track_count: number;
}

export interface Settings {
  hasKey: boolean;
  keySource: "saved" | "env" | null;
  keyHint: string | null;
  baseUrl: string;
  defaultBaseUrl: string;
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface RenderResult {
  hash: string;
  cached: boolean;
  chars: number;
  tier: Tier;
  model: string;
  url: string;
  ms: number;
  request: Record<string, unknown>;
}

export interface MasterPlan {
  model: string;
  segments: number;
  cached: number;
  billable_chars: number;
  total_chars: number;
  too_long: number[];
}
