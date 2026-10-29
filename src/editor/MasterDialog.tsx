import { useEffect, useState } from "react";
import { AlertTriangle, Download, Library, Loader2, Play, Sparkles } from "lucide-react";
import { useApp } from "@/app/store";
import { api as appApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { editorApi as api } from "./api";
import { audio } from "./audio";
import { modelSpec, useStore } from "./store";
import type { MasterPlan } from "./types";

type Phase = "plan" | "rendering" | "done";

export function MasterDialog() {
  const open = useStore((s) => s.masterOpen);
  const timeline = useStore((s) => s.timeline);
  const { setMasterOpen, renderSegment, setMonitor, setPlayhead, togglePlay, toast, select } = useStore.getState();
  const [plan, setPlan] = useState<MasterPlan | null>(null);
  const [phase, setPhase] = useState<Phase>("plan");
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open || !timeline) return;
    setPhase("plan");
    setPlan(null);
    api.masterPlan(timeline.id).then(setPlan).catch((e) => toast(e.message));
  }, [open, timeline?.id, timeline?.master_model]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!timeline) return null;
  const spec = modelSpec(timeline.master_model);
  const missingVoice = spec.catalog !== "vox-2" ? timeline.tracks.filter((t) => !t.master_voice_id) : [];

  const render = async () => {
    const todo = timeline.segments.filter((s) => s.text.trim() && !s.master_ready);
    setPhase("rendering");
    setProgress({ done: 0, failed: 0, total: todo.length });
    // Three in flight keeps well under the API's 60 requests/minute.
    const queue = [...todo];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const ok = await renderSegment(s.id, "master");
        setProgress((p) => ({ ...p, done: p.done + (ok ? 1 : 0), failed: p.failed + (ok ? 0 : 1) }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setPlan(await api.masterPlan(timeline.id));
    setPhase("done");
  };

  const exportWav = async (to: "file" | "library") => {
    setExporting(true);
    try {
      const fresh = useStore.getState().timeline!;
      const blob = await audio.mixdown(fresh);
      if (to === "library") {
        await appApi.uploadLibrary(blob, {
          kind: "mixdown",
          title: `${fresh.name} — master`,
          model: fresh.master_model,
          engine: "cloud",
          project_id: fresh.project_id ?? useApp.getState().activeProjectId,
        });
        toast("Mixdown saved to the Library", "info");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fresh.name.replace(/[^\w\- ]+/g, "").trim() || "master"} — ${timeline.master_model}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const allReady = plan && plan.cached === plan.segments && plan.segments > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => phase !== "rendering" && setMasterOpen(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gold" /> Render Master · {spec.label}
          </DialogTitle>
          <DialogDescription>{spec.note}</DialogDescription>
        </DialogHeader>

        {!plan ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Lines" value={plan.segments} />
            <Stat label="Already cached" value={plan.cached} tone="text-emerald-400" />
            <Stat label="Chars to bill" value={plan.billable_chars} tone="text-gold" />
          </div>
        )}

        {plan && plan.too_long.length > 0 && (
          <Warn>
            {plan.too_long.length} line(s) exceed {spec.maxChars} characters for {spec.label}; they will fail until split.
          </Warn>
        )}
        {missingVoice.length > 0 && (
          <Warn>
            {missingVoice.map((t) => t.name).join(", ")} {missingVoice.length > 1 ? "have" : "has"} no {spec.label} voice yet — the
            preview voice id will be sent and may not exist in that catalogue.{" "}
            <button
              className="underline"
              onClick={() => {
                select({ kind: "track", id: missingVoice[0].id });
                setMasterOpen(false);
              }}
            >
              Set it
            </button>
          </Warn>
        )}

        {phase !== "plan" && (
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{phase === "rendering" ? "Rendering…" : "Finished"}</span>
              <span>
                {progress.done}/{progress.total}
                {progress.failed > 0 && <Badge variant="destructive" className="ml-1.5">{progress.failed} failed</Badge>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-gold transition-all"
                style={{ width: `${progress.total ? ((progress.done + progress.failed) / progress.total) * 100 : 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {!allReady && (
            <Button variant="gold" disabled={!plan || phase === "rendering"} onClick={render} data-testid="start-master">
              {phase === "rendering" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Render {plan ? plan.segments - plan.cached : ""} line(s)
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!plan?.cached || phase === "rendering"}
            onClick={() => {
              setMasterOpen(false);
              setMonitor("master");
              setPlayhead(0);
              togglePlay();
            }}
          >
            <Play /> Play master
          </Button>
          <Button variant={allReady ? "default" : "outline"} disabled={!plan?.cached || exporting || phase === "rendering"} onClick={() => exportWav("file")}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export WAV mixdown
          </Button>
          <Button variant="outline" disabled={!plan?.cached || exporting || phase === "rendering"} onClick={() => exportWav("library")}>
            <Library /> Save to Library
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border bg-background/40 p-2">
      <div className={`font-mono text-lg font-semibold ${tone ?? ""}`}>{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/5 p-2 text-[11px] leading-relaxed text-amber-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
