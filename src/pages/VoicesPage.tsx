import { useMemo, useState } from "react";
import { Loader2, Pencil, Search, Sparkles, Trash2, Wand2 } from "lucide-react";
import { fail, useApp } from "@/app/store";
import { Card, Field, PageHeader } from "@/components/common";
import { VoiceRow } from "@/components/VoicePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { clearVoiceCatalogs, useVoices, voiceFacets } from "@/lib/voices";

// One tab per voice catalogue; the model is what previews and "Use" open with.
const FAMILIES = [
  { model: "vox-2", label: "Vox 2 · Flash" },
  { model: "vox-2.5", label: "Vox 2.5" },
  { model: "vox-3-studio", label: "Vox 3" },
  { model: "vox-3.1", label: "Vox 3.1" },
  { model: "vox-3.5", label: "Vox 3.5" },
  { model: "vox-4", label: "Vox 4" },
];

export function VoicesPage() {
  const navigate = useApp((s) => s.navigate);
  const [family, setFamily] = useState("vox-2");
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [mine, setMine] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { voices, loading, error } = useVoices(family, version);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return voices.filter((v) => {
      const f = voiceFacets(v);
      if (gender && f.gender !== gender) return false;
      if (mine && !f.designed && !f.cloned) return false;
      return !needle || `${v.id} ${v.name} ${v.description ?? ""} ${(v.tags ?? []).join(" ")} ${(v.languages ?? []).join(" ")}`.toLowerCase().includes(needle);
    });
  }, [voices, q, gender, mine]);

  const refresh = () => {
    clearVoiceCatalogs();
    setVersion((n) => n + 1);
  };

  return (
    <div>
      <PageHeader
        title="Voices"
        subtitle="The full catalogue your key can use, plus voices you designed or cloned on voxtts.app. Previews cost ~50 characters once, then come from the local cache."
        actions={
          <Button size="sm" onClick={() => setDesignOpen(true)}>
            <Wand2 /> Design a voice
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-1 border-b pb-3">
          {FAMILIES.map((f) => (
            <button
              key={f.model}
              onClick={() => setFamily(f.model)}
              className={cn("rounded-md px-3 py-1.5 text-xs", family === f.model ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, accent, style, language…" className="h-9 pl-8" />
          </div>
          {["", "female", "male"].map((g) => (
            <Button key={g || "all"} size="sm" variant={gender === g ? "secondary" : "ghost"} onClick={() => setGender(g)}>
              {g ? g[0].toUpperCase() + g.slice(1) : "All"}
            </Button>
          ))}
          <Button size="sm" variant={mine ? "secondary" : "ghost"} onClick={() => setMine(!mine)}>
            My voices
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">{loading ? "Loading…" : `${shown.length} of ${voices.length} voices`}</span>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="grid gap-1 lg:grid-cols-2">
          {shown.slice(0, 400).map((v) => {
            const f = voiceFacets(v);
            return (
              <Card key={v.id} className="p-1.5">
                <VoiceRow
                  voice={v}
                  model={family}
                  actions={
                    <div className="flex shrink-0 items-center gap-1">
                      {f.designed && <DesignedVoiceActions id={v.id} name={v.name} onChange={refresh} />}
                      <Button size="sm" variant="outline" onClick={() => navigate("speech", { model: family, voice: v.id })}>
                        Use
                      </Button>
                    </div>
                  }
                />
              </Card>
            );
          })}
        </div>
        {shown.length > 400 && <p className="text-center text-[11px] text-muted-foreground">Showing 400 of {shown.length}. Narrow the search.</p>}
      </div>
      <DesignDialog open={designOpen} onOpenChange={setDesignOpen} onPublished={refresh} />
    </div>
  );
}

function DesignedVoiceActions({ id, name, onChange }: { id: string; name: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        disabled={busy}
        title="Rename"
        onClick={() => {
          const next = prompt("New name", name);
          if (next && next.trim() !== name) void run(() => api.renameVoice(id, { name: next.trim() }));
        }}
      >
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="hover:text-destructive"
        disabled={busy}
        title="Delete (frees a voice slot; cannot be undone)"
        onClick={() => confirm(`Delete "${name}"? Designed voices cannot be recreated exactly.`) && void run(() => api.deleteVoice(id))}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
    </>
  );
}

function DesignDialog({ open, onOpenChange, onPublished }: { open: boolean; onOpenChange: (o: boolean) => void; onPublished: () => void }) {
  const toast = useApp((s) => s.toast);
  const [prompt, setPrompt] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [samples, setSamples] = useState(2);
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.designVoice>> | null>(null);
  const [name, setName] = useState("");

  const design = async () => {
    setBusy("design");
    try {
      setOut(await api.designVoice({ prompt, preview_text: previewText || undefined, samples, language: language || undefined }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const publish = async (draft_id: string) => {
    setBusy(draft_id);
    try {
      const r = await api.publishVoice({ draft_id, name: name || "My voice", prompt, language: language || undefined });
      toast(`Saved "${r.voice.name}" (${r.voice.id}) to your account`, "info");
      onOpenChange(false);
      setOut(null);
      onPublished();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" /> Design a voice
          </DialogTitle>
          <DialogDescription>
            Describe a voice and hear candidates. Designing bills the preview line once per candidate at the Vox 2 rate; keeping one uses a voice slot.
          </DialogDescription>
        </DialogHeader>
        <Field label="Description" hint={`${prompt.trim().length} characters · at least 20`}>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="A calm British woman in her forties. Dry, unhurried, warm at the edges — a late-night radio host." />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_90px_110px] gap-2">
          <Field label="Preview line (optional)">
            <Input value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="Default line if under 50 chars" />
          </Field>
          <Field label="Candidates">
            <Input type="number" min={1} max={3} value={samples} onChange={(e) => setSamples(Math.max(1, Math.min(3, Number(e.target.value))))} />
          </Field>
          <Field label="Language">
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en-GB" />
          </Field>
        </div>
        <Button onClick={design} disabled={!!busy || prompt.trim().length < 20}>
          {busy === "design" ? <Loader2 className="animate-spin" /> : <Sparkles />} Design
        </Button>
        {out && (
          <div className="space-y-2">
            <Field label="Name to save as">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Midnight Radio" />
            </Field>
            {out.candidates.map((c, i) => (
              <div key={c.draft_id} className="flex items-center gap-2 rounded-md border p-2">
                <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                <audio controls src={`data:${c.content_type};base64,${c.audio_base64}`} className="h-9 min-w-0 flex-1 [color-scheme:dark]" />
                <Button size="sm" disabled={!!busy} onClick={() => publish(c.draft_id)}>
                  {busy === c.draft_id ? <Loader2 className="animate-spin" /> : null} Keep
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
