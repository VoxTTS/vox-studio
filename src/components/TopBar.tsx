import { useState } from "react";
import { FilePlus2, Settings2, Sparkles, Trash2 } from "lucide-react";
import { MASTER_MODELS } from "@shared/directives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { modelSpec, useStore } from "@/lib/store";

export function TopBar() {
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const { openProject, createProject, renameProject, deleteProject, setMasterModel, setSettingsOpen, setMasterOpen } =
    useStore.getState();
  const [editing, setEditing] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
          <svg viewBox="0 0 32 32" className="h-4 w-4">
            <path d="M7 12v8M12 8v16M17 11v10M22 6v20M27 13v6" stroke="white" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-tight">
          Vox <span className="text-muted-foreground">Studio</span>
        </span>
      </div>

      <Select
        value={project?.id ?? ""}
        onChange={(e) => openProject(Number(e.target.value))}
        className="w-44"
        aria-label="Project"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {project &&
        (editing ? (
          <Input
            autoFocus
            defaultValue={project.name}
            className="w-56"
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value !== project.name) renameProject(e.target.value.trim());
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="truncate text-sm font-medium hover:underline" onClick={() => setEditing(true)} title="Rename">
            {project.name}
          </button>
        ))}
      <Button variant="ghost" size="icon" title="New script" onClick={() => createProject("Untitled script")}>
        <FilePlus2 />
      </Button>
      {project && (
        <Button
          variant="ghost"
          size="icon"
          title="Delete script"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => confirm(`Delete "${project.name}"? Cached audio is kept.`) && deleteProject()}
        >
          <Trash2 />
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {project && (
          <>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Master model</span>
            <Select value={project.master_model} onChange={(e) => setMasterModel(e.target.value)} title={modelSpec(project.master_model)?.note}>
              {MASTER_MODELS.map((m) => (
                <option key={m} value={m}>
                  {modelSpec(m).label}
                </option>
              ))}
            </Select>
            <Button variant="gold" onClick={() => setMasterOpen(true)} data-testid="render-master">
              <Sparkles /> Render Master
            </Button>
          </>
        )}
        <Button variant="outline" size="icon" className="relative h-8 w-8" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings2 />
          {settings && !settings.hasKey && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />}
        </Button>
      </div>
    </header>
  );
}
