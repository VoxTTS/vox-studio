import { useState } from "react";
import { FilePlus2, Sparkles, Trash2 } from "lucide-react";
import { MASTER_MODELS } from "@shared/directives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { modelSpec, useStore } from "./store";

export function EditorBar() {
  const timelines = useStore((s) => s.timelines);
  const timeline = useStore((s) => s.timeline);
  const { openTimeline, createTimeline, renameTimeline, deleteTimeline, setMasterModel, setMasterOpen } =
    useStore.getState();
  const [editing, setEditing] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-panel px-3">
      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Add-on</span>

      <Select
        value={timeline?.id ?? ""}
        onChange={(e) => openTimeline(Number(e.target.value))}
        className="w-44"
        aria-label="Timeline"
      >
        {timelines.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {timeline &&
        (editing ? (
          <Input
            autoFocus
            defaultValue={timeline.name}
            className="w-56"
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value !== timeline.name) renameTimeline(e.target.value.trim());
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="truncate text-sm font-medium hover:underline" onClick={() => setEditing(true)} title="Rename">
            {timeline.name}
          </button>
        ))}
      <Button variant="ghost" size="icon" title="New script" onClick={() => createTimeline("Untitled script")}>
        <FilePlus2 />
      </Button>
      {timeline && (
        <Button
          variant="ghost"
          size="icon"
          title="Delete script"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => confirm(`Delete "${timeline.name}"? Cached audio is kept.`) && deleteTimeline()}
        >
          <Trash2 />
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {timeline && (
          <>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Master model</span>
            <Select value={timeline.master_model} onChange={(e) => setMasterModel(e.target.value)} title={modelSpec(timeline.master_model)?.note}>
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
      </div>
    </header>
  );
}
