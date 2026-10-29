import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Play, Sparkles, Trash2, Zap } from "lucide-react";
import { MODELS, PAUSES, PREVIEW_MODEL, VOCAL_EVENTS, combineInstruction, translateText } from "@shared/directives.js";
import { DirectiveText } from "./DirectiveText";
import { VoiceInput } from "./VoiceInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { audio } from "@/lib/audio";
import { modelSpec, segmentDuration, useStore } from "@/lib/store";
import type { Project, Segment, Tier, Track } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

const EMOTION_PRESETS = [
  "whisper, conspiratorial",
  "warm, conversational",
  "excited, fast",
  "sad, barely holding it together",
  "angry, clipped",
  "sarcastic, deadpan",
  "terrified, breathless",
];

const COLORS = ["#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#f87171", "#2dd4bf", "#e5e7eb"];

/** Local draft that commits to the store after a pause in typing (and on blur/unmount). */
function useDraft(value: string, commit: (v: string) => unknown, delay = 450) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<number>();
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = () => {
    window.clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    return v !== null ? Promise.resolve(commitRef.current(v)) : Promise.resolve();
  };
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    draft,
    setDraft(v: string) {
      setDraft(v);
      pending.current = v;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    flush,
    reset: setDraft,
    value,
  };
}

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  if (!project) return null;
  const segment = selection?.kind === "segment" ? project.segments.find((s) => s.id === selection.id) : undefined;
  const track =
    selection?.kind === "track"
      ? project.tracks.find((t) => t.id === selection.id)
      : segment && project.tracks.find((t) => t.id === segment.track_id);

  return (
    <div className="h-[262px] shrink-0 border-t bg-panel" data-testid="inspector">
      {segment && track ? (
        <SegmentInspector key={segment.id} segment={segment} track={track} project={project} />
      ) : track ? (
        <TrackInspector key={track.id} track={track} project={project} />
      ) : (
        <EmptyInspector />
      )}
    </div>
  );
}

function SegmentInspector({ segment, track, project }: { segment: Segment; track: Track; project: Project }) {
  const { patchSegment, deleteSegment, renderSegment } = useStore.getState();
  const rendering = useStore((s) => s.rendering[segment.id]);
  const last = useStore((s) => s.lastRender[segment.id]);
  const monitor = useStore((s) => s.monitor);
  const text = useDraft(segment.text, (v) => patchSegment(segment.id, { text: v }));
  const instruction = useDraft(segment.instruction, (v) => patchSegment(segment.id, { instruction: v }));
  const textRef = useRef<HTMLTextAreaElement>(null);

  const insert = (tag: string) => {
    const el = textRef.current;
    const v = text.draft;
    const start = el?.selectionStart ?? v.length;
    const end = el?.selectionEnd ?? v.length;
    const before = v.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${tag} ${v.slice(end).replace(/^\s+/, "")}`;
    text.setDraft(next);
    requestAnimationFrame(() => {
      const pos = before.length + pad.length + tag.length + 1;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const run = async (tier: Tier) => {
    // Save pending edits first so the server renders exactly what is on screen.
    await Promise.all([text.flush(), instruction.flush()]);
    renderSegment(segment.id, tier, { play: true });
  };

  const masterModel = project.master_model;
  const master = modelSpec(masterModel);
  const fullInstruction = combineInstruction(track.direction, instruction.draft);
  const previewText = translateText(text.draft, PREVIEW_MODEL);
  const masterText = translateText(text.draft, masterModel);
  const tooLong = masterText.length > master.maxChars;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_300px] divide-x">
      {/* Script */}
      <div className="flex min-h-0 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: track.color }} />
          <span className="text-xs font-semibold">{track.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            @ {formatTime(segment.start_ms)} · {(segmentDuration(segment, monitor) / 1000).toFixed(2)}s
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-destructive"
            title="Delete segment (Del)"
            onClick={() => deleteSegment(segment.id)}
          >
            <Trash2 />
          </Button>
        </div>
        <Textarea
          id="segment-text"
          ref={textRef}
          value={text.draft}
          onChange={(e) => text.setDraft(e.target.value)}
          onBlur={() => text.flush()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run("preview");
            }
          }}
          placeholder="Type the line… use <sigh>, <laugh>, <short pause> for vocal events"
          className="min-h-0 flex-1 resize-none font-medium"
          spellCheck
        />
        <div className="flex flex-wrap items-center gap-1">
          <Label className="mr-1">Events</Label>
          {VOCAL_EVENTS.map((ev) => (
            <button
              key={ev}
              onClick={() => insert(`<${ev}>`)}
              className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-400/25"
            >
              &lt;{ev}&gt;
            </button>
          ))}
          {Object.keys(PAUSES).map((p) => (
            <button
              key={p}
              onClick={() => insert(`<${p}>`)}
              className="rounded bg-sky-400/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 hover:bg-sky-400/25"
            >
              &lt;{p}&gt;
            </button>
          ))}
        </div>
      </div>

      {/* Direction */}
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
        <Label htmlFor="segment-instruction">Emotion / delivery</Label>
        <Input
          id="segment-instruction"
          value={instruction.draft}
          onChange={(e) => instruction.setDraft(e.target.value)}
          onBlur={() => instruction.flush()}
          placeholder="e.g. whisper, conspiratorial"
        />
        <div className="flex flex-wrap gap-1">
          {EMOTION_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => instruction.setDraft(p)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-fuchsia-400/50 hover:text-fuchsia-200",
                instruction.draft === p && "border-fuchsia-400/60 text-fuchsia-200",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-1 rounded-md border bg-background/40 p-2 text-[11px] leading-relaxed">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Reads as</div>
          <DirectiveText text={text.draft} />
          {fullInstruction && <div className="mt-1 italic text-fuchsia-300/90">— {fullInstruction}</div>}
        </div>
      </div>

      {/* Render */}
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
        <RenderRow
          icon={<Zap />}
          label="Preview Segment"
          model={PREVIEW_MODEL}
          chars={previewText.length}
          ready={segment.preview_ready}
          busy={rendering === "preview"}
          disabled={!!rendering}
          onRender={() => run("preview")}
          onPlay={() => audio.playOne(segment.preview_hash)}
          hint="Ctrl+Enter"
          warn={fullInstruction ? "Flash ignores emotion direction" : undefined}
        />
        <RenderRow
          icon={<Sparkles />}
          label="Render take"
          model={masterModel}
          chars={masterText.length}
          ready={segment.master_ready}
          busy={rendering === "master"}
          disabled={!!rendering || tooLong}
          onRender={() => run("master")}
          onPlay={() => audio.playOne(segment.master_hash)}
          gold
          warn={
            tooLong
              ? `Over ${master.maxChars} chars for ${master.label} — split this line`
              : !master.instruction && fullInstruction
                ? `${master.label} ignores emotion direction`
                : masterModel === "vox-4" && /<(?!short pause|long pause)[a-z ]+>/i.test(text.draft)
                  ? "Vox 4 drops vocal events (keeps pauses)"
                  : undefined
          }
        />
        {last && (
          <p className="text-[10px] text-muted-foreground">
            Last: {modelSpec(last.model)?.label} · {last.cached ? "served from cache (0 chars billed)" : `${last.ms} ms round trip`}
          </p>
        )}
        <details className="mt-auto text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Request body ({masterModel})</summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-1.5 font-mono">
            {JSON.stringify(
              {
                text: masterText,
                voice_id: track.master_voice_id || track.voice_id,
                model: masterModel,
                ...(master.instruction && fullInstruction ? { instruction: fullInstruction } : {}),
              },
              null,
              1,
            )}
          </pre>
        </details>
      </div>
    </div>
  );
}

function RenderRow(props: {
  icon: React.ReactNode;
  label: string;
  model: string;
  chars: number;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  onRender: () => void;
  onPlay: () => void;
  hint?: string;
  warn?: string;
  gold?: boolean;
}) {
  const spec = modelSpec(props.model);
  return (
    <div className="rounded-md border bg-background/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold">{spec?.label ?? props.model}</span>
        {props.ready ? <Badge variant="success">cached</Badge> : <Badge variant="secondary">{props.chars} chars</Badge>}
        {props.hint && <span className="ml-auto font-mono text-[9px] text-muted-foreground">{props.hint}</span>}
      </div>
      <div className="flex gap-1.5">
        <Button
          variant={props.gold ? "gold" : "default"}
          size="sm"
          className="flex-1"
          disabled={props.disabled}
          onClick={props.onRender}
          data-testid={props.gold ? "render-take" : "preview-segment"}
        >
          {props.busy ? <Loader2 className="animate-spin" /> : props.icon}
          {props.ready ? `Play ${props.gold ? "take" : "preview"}` : props.label}
        </Button>
        {props.ready && (
          <Button variant="outline" size="icon" className="h-7 w-7" title="Play cached audio" onClick={props.onPlay}>
            <Play />
          </Button>
        )}
      </div>
      {props.warn && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-300/90">
          <AlertTriangle className="h-3 w-3 shrink-0" /> {props.warn}
        </p>
      )}
    </div>
  );
}

function TrackInspector({ track, project }: { track: Track; project: Project }) {
  const { patchTrack, deleteTrack } = useStore.getState();
  const name = useDraft(track.name, (v) => v.trim() && patchTrack(track.id, { name: v.trim() }));
  const direction = useDraft(track.direction, (v) => patchTrack(track.id, { direction: v }));
  const master = modelSpec(project.master_model);
  const ownCatalog = Boolean(master.voiceCatalog);
  const lines = project.segments.filter((s) => s.track_id === track.id).length;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x">
      <div className="flex flex-col gap-2 p-3">
        <Label>Character</Label>
        <Input value={name.draft} onChange={(e) => name.setDraft(e.target.value)} onBlur={() => name.flush()} />
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-panel", track.color === c && "ring-2 ring-white")}
              style={{ background: c }}
              onClick={() => patchTrack(track.id, { color: c })}
            />
          ))}
        </div>
        <Label className="mt-1">Track gain · {Math.round(track.gain * 100)}%</Label>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={track.gain}
          onChange={(e) => patchTrack(track.id, { gain: Number(e.target.value) })}
          className="accent-[hsl(var(--primary))]"
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto self-start text-muted-foreground hover:text-destructive"
          onClick={() => {
            if (!lines || confirm(`Delete "${track.name}" and its ${lines} line(s)?`)) deleteTrack(track.id);
          }}
        >
          <Trash2 /> Delete track
        </Button>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <Label>Preview voice · {modelSpec(PREVIEW_MODEL).label}</Label>
        <VoiceInput model={PREVIEW_MODEL} value={track.voice_id} onCommit={(v) => v && patchTrack(track.id, { voice_id: v })} />
        <Label className="mt-2">Master voice · {master.label}</Label>
        <VoiceInput
          model={project.master_model}
          value={track.master_voice_id}
          placeholder={ownCatalog ? "Pick from this model's catalogue" : `Same as preview (${track.voice_id})`}
          onCommit={(v) => patchTrack(track.id, { master_voice_id: v })}
        />
        {ownCatalog && !track.master_voice_id && (
          <p className="flex items-center gap-1 text-[10px] text-amber-300/90">
            <AlertTriangle className="h-3 w-3" /> {master.label} has its own voice catalogue — set a master voice.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <Label>Character direction</Label>
        <Input
          value={direction.draft}
          onChange={(e) => direction.setDraft(e.target.value)}
          onBlur={() => direction.flush()}
          placeholder="e.g. gravelly old sea captain"
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Prepended to every line's emotion annotation and sent as <code className="text-foreground">instruction</code> on models
          that support style direction ({Object.entries(MODELS).filter(([, m]) => m.instruction).map(([, m]) => m.label).join(", ")}).
        </p>
      </div>
    </div>
  );
}

function EmptyInspector() {
  const rows = [
    ["Double-click lane", "New line at that time"],
    ["Double-click block", "Preview it (vox-2-flash)"],
    ["Drag block", "Move in time / to another character (Shift = no snap)"],
    ["Space", "Play / pause timeline"],
    ["Ctrl+Enter", "Preview the selected line"],
    ["Del", "Delete the selected line"],
    ["Ctrl+Wheel", "Zoom the timeline"],
  ];
  return (
    <div className="flex h-full items-center justify-center gap-12 p-6 text-xs text-muted-foreground">
      <div className="max-w-xs leading-relaxed">
        <p className="mb-1 text-sm font-semibold text-foreground">Select a line or a character</p>
        Every render is cached on disk by its exact request (text + voice + model + direction), so re-playing or editing other lines never
        spends characters twice.
      </div>
      <table className="text-[11px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 pr-4 text-right font-mono text-foreground/80">{k}</td>
              <td className="py-0.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
