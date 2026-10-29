import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic2, Plus, Sparkles, Volume2, VolumeX } from "lucide-react";
import { DirectiveText } from "@/components/DirectiveText";
import { Button } from "@/components/ui/button";
import { audibleTracks, segmentDuration, useStore } from "./store";
import type { Segment, Track } from "./types";
import { cn, formatTime } from "@/lib/utils";

const HEADER_W = 208;
const LANE_H = 78;
const RULER_H = 28;
const SNAP_MS = 50;

type Drag = { id: number; dx: number; startMs: number; trackIndex: number; originIndex: number; moved: boolean };

function rulerStep(pxPerSec: number) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return steps.find((s) => s * pxPerSec >= 72) ?? 60;
}

export function Timeline() {
  const timeline = useStore((s) => s.timeline);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const playheadMs = useStore((s) => s.playheadMs);
  const playing = useStore((s) => s.playing);
  const monitor = useStore((s) => s.monitor);
  const selection = useStore((s) => s.selection);
  const { select, setPlayhead, addSegment, patchSegment, setZoom } = useStore.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(1200);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = (playheadMs / 1000) * pxPerSec;
    const visible = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + visible - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - visible * 0.2);
  }, [playheadMs, playing, pxPerSec]);

  // Ctrl/Cmd + wheel zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const pps = useStore.getState().pxPerSec;
      const pointerX = e.clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft;
      const t = pointerX / pps;
      const next = Math.min(400, Math.max(15, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setZoom(next);
      requestAnimationFrame(() => (el.scrollLeft = t * next - (pointerX - el.scrollLeft)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const tracks = timeline?.tracks ?? [];
  const audible = useMemo(() => audibleTracks(tracks), [tracks]);
  const endMs = useMemo(
    () => Math.max(0, ...(timeline?.segments ?? []).map((s) => s.start_ms + segmentDuration(s, monitor))),
    [timeline, monitor],
  );
  const contentW = Math.max(viewW - HEADER_W, ((endMs + 20_000) / 1000) * pxPerSec);

  if (!timeline) return <div className="flex-1" />;

  const msAt = (clientX: number) => {
    const el = scrollRef.current!;
    return ((clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft) / pxPerSec) * 1000;
  };

  const startDrag = (e: React.PointerEvent, seg: Segment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: "segment", id: seg.id });
    const originIndex = tracks.findIndex((t) => t.id === seg.track_id);
    const startX = e.clientX;
    const startY = e.clientY;
    let current: Drag = { id: seg.id, dx: 0, startMs: seg.start_ms, trackIndex: originIndex, originIndex, moved: false };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!current.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      let ms = Math.max(0, seg.start_ms + (dx / pxPerSec) * 1000);
      if (!ev.shiftKey) ms = Math.round(ms / SNAP_MS) * SNAP_MS;
      const trackIndex = Math.min(tracks.length - 1, Math.max(0, originIndex + Math.round(dy / LANE_H)));
      current = { ...current, dx, startMs: ms, trackIndex, moved: true };
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!current.moved) return;
      const patch: Partial<Segment> = { start_ms: Math.round(current.startMs) };
      if (current.trackIndex !== originIndex) patch.track_id = tracks[current.trackIndex].id;
      patchSegment(seg.id, patch);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const scrub = (e: React.PointerEvent) => {
    setPlayhead(msAt(e.clientX));
    const move = (ev: PointerEvent) => setPlayhead(msAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = rulerStep(pxPerSec);
  const ticks = Math.ceil(contentW / pxPerSec / step) + 1;
  const playheadX = (playheadMs / 1000) * pxPerSec;

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-background" data-testid="timeline">
      <div className="relative" style={{ width: HEADER_W + contentW, minHeight: "100%" }}>
        {/* Ruler */}
        <div className="sticky top-0 z-30 flex border-b bg-panel" style={{ height: RULER_H }}>
          <div
            className="sticky left-0 z-40 flex items-center justify-between border-r bg-panel px-3 text-[10px] uppercase tracking-wider text-muted-foreground"
            style={{ width: HEADER_W, minWidth: HEADER_W }}
          >
            <span>Tracks · {tracks.length}</span>
            <span className="font-mono normal-case">{formatTime(endMs, false)}</span>
          </div>
          <div className="relative cursor-col-resize select-none" style={{ width: contentW }} onPointerDown={scrub}>
            {Array.from({ length: ticks }, (_, i) => {
              const sec = i * step;
              return (
                <div key={i} className="absolute top-0 h-full border-l border-border/80" style={{ left: sec * pxPerSec }}>
                  <span className="absolute left-1 top-1 font-mono text-[10px] text-muted-foreground">
                    {formatTime(sec * 1000, step < 1)}
                  </span>
                  {[1, 2, 3].map((q) => (
                    <div
                      key={q}
                      className="absolute bottom-0 h-1.5 border-l border-border/60"
                      style={{ left: (q * step * pxPerSec) / 4 }}
                    />
                  ))}
                </div>
              );
            })}
            <div className="pointer-events-none absolute top-0 h-full" style={{ left: playheadX }}>
              <div className="-ml-[5px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-primary" />
            </div>
          </div>
        </div>

        {/* Lanes */}
        {tracks.map((track, index) => (
          <div key={track.id} className="flex border-b" style={{ height: LANE_H }}>
            <TrackHeader track={track} audible={audible.has(track.id)} selected={selection?.kind === "track" && selection.id === track.id} />
            <div
              className={cn(
                "relative bg-lane",
                index % 2 && "bg-lane/60",
                drag && drag.trackIndex === index && drag.trackIndex !== drag.originIndex && "bg-primary/5",
              )}
              style={{ width: contentW }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                select(null);
                setPlayhead(msAt(e.clientX));
              }}
              onDoubleClick={(e) => {
                if (e.target !== e.currentTarget) return;
                addSegment(track.id, Math.round(msAt(e.clientX) / SNAP_MS) * SNAP_MS);
              }}
            >
              {timeline.segments
                .filter((s) => (drag?.id === s.id ? tracks[drag.trackIndex]?.id === track.id : s.track_id === track.id))
                .map((s) => (
                  <SegmentBlock
                    key={s.id}
                    segment={s}
                    track={track}
                    left={((drag?.id === s.id ? drag.startMs : s.start_ms) / 1000) * pxPerSec}
                    width={(segmentDuration(s, monitor) / 1000) * pxPerSec}
                    selected={selection?.kind === "segment" && selection.id === s.id}
                    dimmed={!audible.has(track.id)}
                    dragging={drag?.id === s.id}
                    onPointerDown={(e) => startDrag(e, s)}
                  />
                ))}
            </div>
          </div>
        ))}

        <AddTrackRow />

        {/* Playhead */}
        <div
          className="pointer-events-none absolute bottom-0 z-10 w-px bg-primary shadow-[0_0_6px_hsl(var(--primary))]"
          style={{ left: HEADER_W + playheadX, top: RULER_H }}
        />
      </div>
    </div>
  );
}

function TrackHeader({ track, audible, selected }: { track: Track; audible: boolean; selected: boolean }) {
  const { select, patchTrack, addSegment } = useStore.getState();
  const masterModel = useStore((s) => s.timeline?.master_model);
  const endOfTrack = useStore((s) =>
    Math.max(0, ...(s.timeline?.segments ?? []).filter((x) => x.track_id === track.id).map((x) => x.start_ms + segmentDuration(x, s.monitor) + 300)),
  );
  return (
    <div
      className={cn(
        "group sticky left-0 z-20 flex shrink-0 cursor-pointer flex-col justify-between border-r bg-panel px-2.5 py-2 hover:bg-[hsl(240_7%_10%)]",
        selected && "bg-[hsl(240_7%_11%)]",
      )}
      style={{ width: HEADER_W, minWidth: HEADER_W }}
      onClick={() => select({ kind: "track", id: track.id })}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-1 rounded-full" style={{ background: track.color }} />
        <span className={cn("truncate text-[13px] font-semibold", !audible && "text-muted-foreground")}>{track.name}</span>
      </div>
      <div className="flex items-center gap-1 truncate pl-3 font-mono text-[10px] text-muted-foreground" title="Preview voice · master voice">
        <Mic2 className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {track.voice_id}
          {masterModel && track.master_voice_id ? ` · ${track.master_voice_id}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-1 pl-2.5">
        <button
          className={cn(
            "h-5 w-5 rounded text-[10px] font-bold",
            track.muted ? "bg-destructive/80 text-white" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
          title="Mute"
          onClick={(e) => {
            e.stopPropagation();
            patchTrack(track.id, { muted: track.muted ? 0 : 1 });
          }}
        >
          M
        </button>
        <button
          className={cn(
            "h-5 w-5 rounded text-[10px] font-bold",
            track.solo ? "bg-gold text-black" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
          title="Solo"
          onClick={(e) => {
            e.stopPropagation();
            patchTrack(track.id, { solo: track.solo ? 0 : 1 });
          }}
        >
          S
        </button>
        {audible ? <Volume2 className="ml-1 h-3 w-3 text-muted-foreground" /> : <VolumeX className="ml-1 h-3 w-3 text-destructive" />}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-5 px-1.5 text-[10px] opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            addSegment(track.id, endOfTrack);
          }}
        >
          <Plus /> Line
        </Button>
      </div>
    </div>
  );
}

function SegmentBlock({
  segment,
  track,
  left,
  width,
  selected,
  dimmed,
  dragging,
  onPointerDown,
}: {
  segment: Segment;
  track: Track;
  left: number;
  width: number;
  selected: boolean;
  dimmed: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const rendering = useStore((s) => s.rendering[segment.id]);
  const { renderSegment } = useStore.getState();
  const estimated = !segment.preview_duration_ms && !segment.master_duration_ms;
  return (
    <div
      data-segment={segment.id}
      className={cn(
        "absolute top-1.5 flex cursor-grab flex-col overflow-hidden rounded-md border px-2 py-1 text-[11.5px] leading-snug shadow-sm transition-[box-shadow,opacity]",
        selected && "ring-2 ring-white/80",
        dragging && "cursor-grabbing opacity-90 shadow-xl",
        dimmed && "opacity-40",
        estimated && "border-dashed",
      )}
      style={{
        left,
        width: Math.max(width, 24),
        height: LANE_H - 12,
        background: `color-mix(in srgb, ${track.color} 22%, hsl(240 7% 9%))`,
        borderColor: `color-mix(in srgb, ${track.color} 60%, transparent)`,
      }}
      title={estimated ? "Width is an estimate until the segment is rendered" : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        renderSegment(segment.id, "preview", { play: true });
      }}
    >
      <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
        {rendering ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-foreground" />
        ) : (
          <span
            className={cn("h-1.5 w-1.5 rounded-full", segment.preview_ready ? "bg-emerald-400" : "bg-muted-foreground/40")}
            title={segment.preview_ready ? "Preview cached" : "No preview yet"}
          />
        )}
        {segment.master_ready && <Sparkles className="h-2.5 w-2.5 text-gold" aria-label="Master cached" />}
        {segment.instruction && <span className="truncate italic text-fuchsia-300/90">“{segment.instruction}”</span>}
      </div>
      <div className="line-clamp-2 select-none text-foreground/95">
        <DirectiveText text={segment.text} />
      </div>
    </div>
  );
}

function AddTrackRow() {
  const addTrack = useStore((s) => s.addTrack);
  return (
    <div className="flex" style={{ height: 40 }}>
      <div className="sticky left-0 z-20 flex items-center border-r bg-panel px-2" style={{ width: HEADER_W, minWidth: HEADER_W }}>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={addTrack}>
          <Plus /> Add character track
        </Button>
      </div>
    </div>
  );
}
