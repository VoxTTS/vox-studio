import { useMemo, useState } from "react";
import { ChevronDown, Loader2, Pause, Play, Search } from "lucide-react";
import { fail, useApp } from "@/app/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Voice } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useVoices, voiceFacets } from "@/lib/voices";
import { MODELS } from "@shared/directives.js";

// One shared element so starting a preview stops the previous one.
const player = typeof Audio !== "undefined" ? new Audio() : null;

/**
 * Play a short sample of a voice. The first play renders ~50 characters on the
 * cheapest compatible model; afterwards it is served from the local cache.
 */
export function PreviewButton({ model, voice, className }: { model: string; voice: Voice; className?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!player) return;
    if (state === "playing") {
      player.pause();
      return setState("idle");
    }
    setState("loading");
    try {
      const { url } = await api.previewVoice(model, voice.id, voiceFacets(voice).language ?? undefined);
      player.pause();
      player.src = url;
      player.onended = player.onpause = () => setState("idle");
      await player.play();
      setState("playing");
    } catch (err) {
      setState("idle");
      fail(err);
    }
  };
  return (
    <button
      onClick={toggle}
      title="Preview (about 50 characters the first time, then cached)"
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:border-primary hover:text-primary",
        state === "playing" && "border-primary text-primary",
        className,
      )}
    >
      {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "playing" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
    </button>
  );
}

/** Button showing the chosen voice; opens a searchable catalogue for the model. */
export function VoicePicker({
  model,
  value,
  onChange,
  className,
  placeholder = "Choose a voice",
}: {
  model: string;
  value: string;
  onChange: (id: string, voice?: Voice) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { voices, loading, error } = useVoices(model);
  const hasKey = useApp((s) => s.settings?.hasKey);
  const current = voices.find((v) => v.id === value);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background/60 px-2.5 text-left text-xs hover:border-primary/60",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {current ? (
            <>
              <span className="font-medium">{current.name}</span>
              {current.description && <span className="ml-1.5 text-muted-foreground">{current.description}</span>}
            </>
          ) : value ? (
            <span className="font-mono">{value}</span>
          ) : (
            <span className="text-muted-foreground">{!hasKey ? "Add an API key to load voices" : loading ? "Loading voices…" : placeholder}</span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      <VoiceDialog
        open={open}
        onOpenChange={setOpen}
        model={model}
        voices={voices}
        loading={loading}
        error={error}
        value={value}
        onPick={(v) => {
          onChange(v.id, v);
          setOpen(false);
        }}
      />
    </>
  );
}

function VoiceDialog({
  open,
  onOpenChange,
  model,
  voices,
  loading,
  error,
  value,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  model: string;
  voices: Voice[];
  loading: boolean;
  error: string | null;
  value: string;
  onPick: (v: Voice) => void;
}) {
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<string>("");
  const [mine, setMine] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return voices.filter((v) => {
      const f = voiceFacets(v);
      if (gender && f.gender !== gender) return false;
      if (mine && !f.designed && !f.cloned) return false;
      if (!needle) return true;
      return `${v.id} ${v.name} ${v.description ?? ""} ${(v.tags ?? []).join(" ")} ${(v.languages ?? []).join(" ")}`.toLowerCase().includes(needle);
    });
  }, [voices, q, gender, mine]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{MODELS[model]?.label ?? model} voices</DialogTitle>
          <DialogDescription>
            {loading ? "Loading…" : `${voices.length} voices`}. Previews cost about 50 characters the first time and are free after that.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, accent, style, language…" className="h-9 pl-8" />
          </div>
          {["", "female", "male"].map((g) => (
            <Button key={g || "all"} size="sm" variant={gender === g ? "secondary" : "ghost"} onClick={() => setGender(g)}>
              {g ? g[0].toUpperCase() + g.slice(1) : "All"}
            </Button>
          ))}
          <Button size="sm" variant={mine ? "secondary" : "ghost"} onClick={() => setMine(!mine)}>
            My voices
          </Button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {error && <p className="p-3 text-xs text-destructive">{error}</p>}
          {shown.slice(0, 300).map((v) => (
            <VoiceRow key={v.id} voice={v} model={model} selected={v.id === value} onPick={() => onPick(v)} />
          ))}
          {shown.length > 300 && <p className="p-3 text-center text-[11px] text-muted-foreground">Showing 300 of {shown.length}. Narrow the search.</p>}
          {!loading && !shown.length && !error && <p className="p-6 text-center text-xs text-muted-foreground">No voices match.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VoiceRow({ voice, model, selected, onPick, actions }: { voice: Voice; model: string; selected?: boolean; onPick?: () => void; actions?: React.ReactNode }) {
  const f = voiceFacets(voice);
  return (
    <div
      onClick={onPick}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2",
        onPick && "cursor-pointer hover:bg-accent/60",
        selected && "bg-primary/10 ring-1 ring-inset ring-primary/40",
      )}
    >
      <PreviewButton model={model} voice={voice} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{voice.name}</span>
          {f.designed && <Badge>designed</Badge>}
          {f.cloned && <Badge variant="gold">cloned</Badge>}
          {f.gender && <Badge variant="secondary">{f.gender}</Badge>}
          {voice.languages?.slice(0, 3).map((l) => (
            <Badge key={l} variant="outline">
              {l}
            </Badge>
          ))}
        </div>
        {voice.description && <p className="truncate text-[11px] text-muted-foreground">{voice.description}</p>}
      </div>
      {actions}
    </div>
  );
}
