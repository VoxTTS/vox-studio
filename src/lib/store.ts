import { create } from "zustand";
import { MODELS } from "@shared/directives.js";
import { api } from "./api";
import { audio } from "./audio";
import type { Project, ProjectSummary, Segment, Settings, Tier, Track } from "./types";

export type Selection = { kind: "segment"; id: number } | { kind: "track"; id: number } | null;
type Toast = { id: number; message: string; tone: "error" | "info" };

interface State {
  projects: ProjectSummary[];
  project: Project | null;
  settings: Settings | null;
  selection: Selection;
  pxPerSec: number;
  playheadMs: number;
  playing: boolean;
  monitor: Tier;
  rendering: Record<number, Tier | undefined>;
  lastRender: Record<number, { ms: number; cached: boolean; model: string } | undefined>;
  toasts: Toast[];
  settingsOpen: boolean;
  masterOpen: boolean;

  init(): Promise<void>;
  openProject(id: number): Promise<void>;
  createProject(name: string): Promise<void>;
  renameProject(name: string): void;
  deleteProject(): Promise<void>;
  setMasterModel(model: string): void;

  addTrack(): void;
  patchTrack(id: number, patch: Partial<Track>): void;
  deleteTrack(id: number): void;

  addSegment(trackId: number, startMs: number): Promise<void>;
  patchSegment(id: number, patch: Partial<Segment>): Promise<void>;
  deleteSegment(id: number): void;
  packTimeline(): void;

  renderSegment(id: number, tier: Tier, opts?: { play?: boolean }): Promise<boolean>;
  setDuration(hash: string, ms: number): void;

  select(sel: Selection): void;
  setZoom(pxPerSec: number): void;
  setPlayhead(ms: number): void;
  setMonitor(tier: Tier): void;
  togglePlay(): Promise<void>;
  stop(): void;

  setSettings(s: Settings): void;
  setSettingsOpen(open: boolean): void;
  setMasterOpen(open: boolean): void;
  toast(message: string, tone?: Toast["tone"]): void;
  dismissToast(id: number): void;
}

/** Rough read-time until a segment has real audio: ~15 chars/sec plus pauses. */
export function estimateMs(text: string) {
  const pauses = (text.match(/<(short|long) pause>/g) || []).length * 700;
  const spoken = text.replace(/<[^>]+>|\[[^\]]+\]/g, "").trim().length;
  return Math.max(900, spoken * 66 + pauses);
}

export function segmentDuration(s: Segment, monitor: Tier) {
  const preferred = monitor === "master" ? s.master_duration_ms ?? s.preview_duration_ms : s.preview_duration_ms ?? s.master_duration_ms;
  return preferred ?? estimateMs(s.text);
}

export function audibleTracks(tracks: Track[]) {
  const soloed = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => (soloed ? t.solo : !t.muted)).map((t) => t.id));
}

// Responses arrive out of order when edits are quick; only the newest may replace local state.
let seq = 0;
let toastId = 0;

export const useStore = create<State>((set, get) => {
  const fail = (err: unknown) => get().toast(err instanceof Error ? err.message : String(err));

  /** Apply a local change immediately, then adopt the server's view of the project. */
  async function mutate(local: (p: Project) => Project, remote: () => Promise<Project>) {
    const p = get().project;
    if (p) set({ project: local(p) });
    const mine = ++seq;
    try {
      const next = await remote();
      if (mine === seq) set({ project: next });
    } catch (err) {
      fail(err);
      if (p) {
        const fresh = await api.project(p.id).catch(() => null);
        if (fresh && mine === seq) set({ project: fresh });
      }
    }
  }

  return {
    projects: [],
    project: null,
    settings: null,
    selection: null,
    pxPerSec: 80,
    playheadMs: 0,
    playing: false,
    monitor: "preview",
    rendering: {},
    lastRender: {},
    toasts: [],
    settingsOpen: false,
    masterOpen: false,

    async init() {
      try {
        const [settings, projects] = await Promise.all([api.settings(), api.projects()]);
        set({ settings, projects, settingsOpen: !settings.hasKey });
        const last = Number(localStorage.getItem("vox-studio:project"));
        const target = projects.find((p) => p.id === last) ?? projects[0];
        if (target) await get().openProject(target.id);
      } catch (err) {
        fail(err);
      }
    },

    async openProject(id) {
      get().stop();
      try {
        const project = await api.project(id);
        set({ project, selection: null, playheadMs: 0 });
        localStorage.setItem("vox-studio:project", String(id));
        audio.measureMissing(project);
      } catch (err) {
        fail(err);
      }
    },

    async createProject(name) {
      try {
        const project = await api.createProject(name);
        set({ project, selection: null, playheadMs: 0, projects: await api.projects() });
        localStorage.setItem("vox-studio:project", String(project.id));
      } catch (err) {
        fail(err);
      }
    },

    renameProject(name) {
      const p = get().project;
      if (!p) return;
      mutate((x) => ({ ...x, name }), () => api.patchProject(p.id, { name })).then(async () =>
        set({ projects: await api.projects() }),
      );
    },

    async deleteProject() {
      const p = get().project;
      if (!p) return;
      try {
        await api.deleteProject(p.id);
        const projects = await api.projects();
        set({ projects, project: null });
        if (projects[0]) await get().openProject(projects[0].id);
      } catch (err) {
        fail(err);
      }
    },

    setMasterModel(model) {
      const p = get().project;
      if (!p) return;
      mutate((x) => ({ ...x, master_model: model }), () => api.patchProject(p.id, { master_model: model })).then(
        () => get().project && audio.measureMissing(get().project!),
      );
    },

    addTrack() {
      const p = get().project;
      if (p) mutate((x) => x, () => api.addTrack(p.id));
    },

    patchTrack(id, patch) {
      mutate(
        (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
        () => api.patchTrack(id, patch),
      );
    },

    deleteTrack(id) {
      const sel = get().selection;
      if (sel?.kind === "track" && sel.id === id) set({ selection: null });
      mutate(
        (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id), segments: p.segments.filter((s) => s.track_id !== id) }),
        () => api.deleteTrack(id),
      );
    },

    async addSegment(trackId, startMs) {
      try {
        const { id, project } = await api.addSegment(trackId, { text: "", start_ms: startMs });
        ++seq;
        set({ project, selection: { kind: "segment", id } });
        requestAnimationFrame(() => document.getElementById("segment-text")?.focus());
      } catch (err) {
        fail(err);
      }
    },

    patchSegment(id, patch) {
      return mutate(
        (p) => ({ ...p, segments: p.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
        () => api.patchSegment(id, patch),
      );
    },

    deleteSegment(id) {
      const sel = get().selection;
      if (sel?.kind === "segment" && sel.id === id) set({ selection: null });
      mutate((p) => ({ ...p, segments: p.segments.filter((s) => s.id !== id) }), () => api.deleteSegment(id));
    },

    packTimeline() {
      const { project: p, monitor } = get();
      if (!p) return;
      const GAP = 350;
      let cursor = 0;
      const moves = [...p.segments]
        .sort((a, b) => a.start_ms - b.start_ms || a.id - b.id)
        .map((s) => {
          const move = { id: s.id, start_ms: cursor };
          cursor += segmentDuration(s, monitor) + GAP;
          return move;
        });
      const at = new Map(moves.map((m) => [m.id, m.start_ms]));
      mutate(
        (x) => ({ ...x, segments: x.segments.map((s) => ({ ...s, start_ms: at.get(s.id) ?? s.start_ms })) }),
        () => api.arrange(p.id, moves),
      );
    },

    async renderSegment(id, tier, opts = {}) {
      if (get().rendering[id]) return false;
      set((s) => ({ rendering: { ...s.rendering, [id]: tier } }));
      try {
        const result = await api.render(id, tier);
        set((s) => ({ lastRender: { ...s.lastRender, [id]: { ms: result.ms, cached: result.cached, model: result.model } } }));
        const p = get().project;
        if (p) {
          const mine = ++seq;
          const fresh = await api.project(p.id);
          if (mine === seq) set({ project: fresh });
        }
        if (opts.play) await audio.playOne(result.hash);
        else await audio.load(result.hash);
        return true;
      } catch (err) {
        fail(err);
        return false;
      } finally {
        set((s) => ({ rendering: { ...s.rendering, [id]: undefined } }));
      }
    },

    setDuration(hash, ms) {
      const p = get().project;
      if (!p) return;
      set({
        project: {
          ...p,
          segments: p.segments.map((s) =>
            s.preview_hash === hash
              ? { ...s, preview_duration_ms: ms }
              : s.master_hash === hash
                ? { ...s, master_duration_ms: ms }
                : s,
          ),
        },
      });
    },

    select(selection) {
      set({ selection });
    },
    setZoom(pxPerSec) {
      set({ pxPerSec: Math.min(400, Math.max(15, pxPerSec)) });
    },
    setPlayhead(ms) {
      const wasPlaying = get().playing;
      if (wasPlaying) audio.stop();
      set({ playheadMs: Math.max(0, ms), playing: false });
      if (wasPlaying) get().togglePlay();
    },
    setMonitor(monitor) {
      const wasPlaying = get().playing;
      get().stop();
      set({ monitor });
      if (wasPlaying) get().togglePlay();
    },

    async togglePlay() {
      const { playing, project, playheadMs, monitor } = get();
      if (playing) return get().stop();
      if (!project) return;
      set({ playing: true });
      try {
        await audio.playTimeline(project, playheadMs, monitor, (ms) => set({ playheadMs: ms }), () =>
          set({ playing: false }),
        );
      } catch (err) {
        set({ playing: false });
        fail(err);
      }
    },

    stop() {
      audio.stop();
      set({ playing: false });
    },

    setSettings(settings) {
      set({ settings });
    },
    setSettingsOpen(settingsOpen) {
      set({ settingsOpen });
    },
    setMasterOpen(masterOpen) {
      set({ masterOpen });
    },
    toast(message, tone = "error") {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
      setTimeout(() => get().dismissToast(id), tone === "error" ? 7000 : 3500);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

export function modelSpec(model: string) {
  return MODELS[model];
}
