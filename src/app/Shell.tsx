import type { ReactNode } from "react";
import { AudioLines, BookOpen, Cpu, Folder, KeyRound, Library, Mic, Podcast, SlidersHorizontal, Users } from "lucide-react";
import { type Route, useApp } from "./store";
import { ProjectPicker } from "@/components/common";
import { cn } from "@/lib/utils";

const NAV: { group: string; items: { route: Route; label: string; icon: ReactNode; badge?: string }[] }[] = [
  {
    group: "Playground",
    items: [
      { route: "speech", label: "Speech", icon: <AudioLines /> },
      { route: "podcast", label: "Podcast", icon: <Podcast /> },
      { route: "audiobook", label: "Audiobook", icon: <BookOpen /> },
      { route: "transcribe", label: "Transcribe", icon: <Mic /> },
    ],
  },
  {
    group: "Workspace",
    items: [
      { route: "voices", label: "Voices", icon: <Users /> },
      { route: "library", label: "Library", icon: <Library /> },
      { route: "projects", label: "Projects", icon: <Folder /> },
    ],
  },
  { group: "Add-ons", items: [{ route: "editor", label: "Timeline editor", icon: <SlidersHorizontal />, badge: "add-on" }] },
  {
    group: "Settings",
    items: [
      { route: "models", label: "Local models", icon: <Cpu /> },
      { route: "key", label: "API key", icon: <KeyRound /> },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const downloading = useApp((s) => s.localModels.some((m) => m.status === "downloading"));

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-panel">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden>
              <path d="M7 12v8M12 8v16M17 11v10M22 6v20M27 13v6" stroke="white" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              Vox<span className="text-primary">TTS</span> Studio
            </div>
            <div className="text-[10px] text-muted-foreground">local edition</div>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.group}</div>
              {g.items.map((item) => (
                <button
                  key={item.route}
                  onClick={() => navigate(item.route)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:h-4 [&_svg]:w-4",
                    route === item.route && "bg-primary/15 font-medium text-foreground [&_svg]:text-primary",
                  )}
                  data-nav={item.route}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && <span className="rounded bg-secondary px-1 text-[9px] uppercase text-muted-foreground">{item.badge}</span>}
                  {item.route === "key" && settings && !settings.hasKey && <span className="h-2 w-2 rounded-full bg-destructive" />}
                  {item.route === "models" && downloading && <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <ProjectPicker />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
