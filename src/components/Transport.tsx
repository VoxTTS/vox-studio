import { useState } from "react";
import { AlignHorizontalJustifyStart, Loader2, Pause, Play, SkipBack, Zap, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { segmentDuration, useStore } from "@/lib/store";
import { cn, formatTime } from "@/lib/utils";

export function Transport() {
  const playing = useStore((s) => s.playing);
  const playheadMs = useStore((s) => s.playheadMs);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const monitor = useStore((s) => s.monitor);
  const project = useStore((s) => s.project);
  const { togglePlay, setPlayhead, setZoom, setMonitor, packTimeline, renderSegment } = useStore.getState();
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const segments = project?.segments ?? [];
  const missing = segments.filter((s) => s.text.trim() && !s.preview_ready);
  const total = Math.max(0, ...segments.map((s) => s.start_ms + segmentDuration(s, monitor)));

  const previewAll = async () => {
    setBatch({ done: 0, total: missing.length });
    let done = 0;
    const queue = [...missing];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        await renderSegment(s.id, "preview");
        setBatch({ done: ++done, total: missing.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBatch(null);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-panel/70 px-3">
      <Button variant="ghost" size="icon" title="Back to start" onClick={() => setPlayhead(0)}>
        <SkipBack />
      </Button>
      <Button size="icon" className="h-8 w-8 rounded-full" title="Play / pause (Space)" onClick={togglePlay} data-testid="play">
        {playing ? <Pause /> : <Play className="translate-x-px" />}
      </Button>
      <div className="ml-1 rounded-md border bg-background px-2 py-1 font-mono text-[13px] tabular-nums">
        {formatTime(playheadMs)} <span className="text-muted-foreground">/ {formatTime(total, false)}</span>
      </div>

      <div className="ml-3 flex rounded-md border p-0.5 text-[11px]" title="Which renders to hear on the timeline">
        {(["preview", "master"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMonitor(m)}
            className={cn(
              "rounded px-2.5 py-1 capitalize",
              monitor === m ? (m === "master" ? "bg-gold text-black" : "bg-primary text-white") : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <Button variant="secondary" size="sm" className="ml-2" disabled={!missing.length || !!batch} onClick={previewAll}>
        {batch ? <Loader2 className="animate-spin" /> : <Zap />}
        {batch ? `Previewing ${batch.done}/${batch.total}` : `Preview missing (${missing.length})`}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Lay every line end to end in start order, with a short gap"
        onClick={() => confirm("Re-space every line end-to-end in its current order?") && packTimeline()}
      >
        <AlignHorizontalJustifyStart /> Pack
      </Button>

      <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        <Button variant="ghost" size="icon" onClick={() => setZoom(pxPerSec / 1.25)} title="Zoom out">
          <ZoomOut />
        </Button>
        <input
          type="range"
          min={15}
          max={400}
          value={pxPerSec}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-28 accent-[hsl(var(--primary))]"
          aria-label="Zoom"
        />
        <Button variant="ghost" size="icon" onClick={() => setZoom(pxPerSec * 1.25)} title="Zoom in">
          <ZoomIn />
        </Button>
      </div>
    </div>
  );
}
