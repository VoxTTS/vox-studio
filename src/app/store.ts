import { useMemo } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";
import type { LocalModel, Project, Settings } from "@/lib/types";

export type Route = "speech" | "podcast" | "audiobook" | "transcribe" | "voices" | "library" | "projects" | "editor" | "models" | "key";
const ROUTES: Route[] = ["speech", "podcast", "audiobook", "transcribe", "voices", "library", "projects", "editor", "models", "key"];

type Toast = { id: number; message: string; tone: "error" | "info" };

interface AppState {
  route: Route;
  routeParams: URLSearchParams;
  settings: Settings | null;
  projects: Project[];
  /** Where new work is filed; null = unfiled. */
  activeProjectId: number | null;
  localModels: LocalModel[];
  toasts: Toast[];

  init(): Promise<void>;
  navigate(route: Route, params?: Record<string, string>): void;
  refreshSettings(): Promise<void>;
  setSettings(s: Settings): void;
  refreshProjects(): Promise<void>;
  setActiveProject(id: number | null): void;
  refreshLocalModels(): Promise<void>;
  toast(message: string, tone?: Toast["tone"]): void;
  dismissToast(id: number): void;
}

function parseHash() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const route = (ROUTES.includes(path as Route) ? path : "speech") as Route;
  return { route, routeParams: new URLSearchParams(query) };
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  ...parseHash(),
  settings: null,
  projects: [],
  activeProjectId: (() => {
    try {
      const v = localStorage.getItem("vox-studio:active-project");
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  })(),
  localModels: [],
  toasts: [],

  async init() {
    window.addEventListener("hashchange", () => set(parseHash()));
    try {
      const [settings] = await Promise.all([api.settings(), get().refreshProjects(), get().refreshLocalModels()]);
      set({ settings });
      if (!settings.hasKey && !location.hash) get().navigate("key");
    } catch (err) {
      get().toast((err as Error).message);
    }
  },

  navigate(route, params) {
    location.hash = `/${route}${params ? `?${new URLSearchParams(params)}` : ""}`;
  },

  async refreshSettings() {
    set({ settings: await api.settings() });
  },
  setSettings(settings) {
    set({ settings });
  },

  async refreshProjects() {
    const { projects } = await api.projects();
    const active = get().activeProjectId;
    set({ projects, activeProjectId: projects.some((p) => p.id === active && !p.archived) ? active : null });
  },

  setActiveProject(id) {
    set({ activeProjectId: id });
    try {
      if (id === null) localStorage.removeItem("vox-studio:active-project");
      else localStorage.setItem("vox-studio:active-project", String(id));
    } catch {
      // storage unavailable; the choice just won't persist
    }
  },

  async refreshLocalModels() {
    set({ localModels: (await api.localModels()).models });
  },

  toast(message, tone = "error") {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 8000 : 3500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Report a failure from any async UI action as a toast. */
export function fail(err: unknown) {
  useApp.getState().toast(err instanceof Error ? err.message : String(err));
}

/** Downloaded local models that are ready for a task (stable between renders). */
export function useReadyLocalModels(task: "tts" | "stt") {
  const all = useApp((s) => s.localModels);
  return useMemo(() => all.filter((m) => m.task === task && m.status === "ready"), [all, task]);
}
