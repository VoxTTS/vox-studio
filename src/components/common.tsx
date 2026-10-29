import type * as React from "react";
import type { ReactNode } from "react";
import { Download, FolderOpen } from "lucide-react";
import { MODELS } from "@shared/directives.js";
import { useApp } from "@/app/store";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b px-6 pb-4 pt-5">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | number }) {
  return (
    <div className={cn("rounded-lg border bg-panel p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:h-6 [&_svg]:w-6">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-md text-xs leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

export function AudioPlayer({ src, download, className }: { src: string; download?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <audio controls preload="none" src={src} className="h-9 w-full min-w-0 [color-scheme:dark]" />
      {download && (
        <a
          href={`${src}${src.includes("?") ? "&" : "?"}download=1`}
          download={download}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

/** Cloud model dropdown; `only` limits the choice (e.g. dialogue-capable models). */
export function ModelSelect({ value, onChange, only, className }: { value: string; onChange: (m: string) => void; only?: string[]; className?: string }) {
  const ids = only ?? Object.keys(MODELS);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn("w-full", className)}>
      {ids.map((m) => (
        <option key={m} value={m}>
          {MODELS[m].label}
        </option>
      ))}
    </Select>
  );
}

/** "Saving to" project picker; new work is filed into the active project. */
export function ProjectPicker({ compact }: { compact?: boolean }) {
  const projects = useApp((s) => s.projects);
  const active = useApp((s) => s.activeProjectId);
  const setActive = useApp((s) => s.setActiveProject);
  return (
    <div className="flex items-center gap-1.5">
      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {!compact && <span className="text-[11px] text-muted-foreground">Saving to</span>}
      <Select
        value={active ?? ""}
        onChange={(e) => setActive(e.target.value ? Number(e.target.value) : null)}
        className="h-7 min-w-0 flex-1 text-[11px]"
        aria-label="Active project"
      >
        <option value="">No project</option>
        {projects
          .filter((p) => !p.archived)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
    </div>
  );
}

export function formatBytes(n: number) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function timeAgo(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString();
}
