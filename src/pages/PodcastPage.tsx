import { useState } from "react";
import { ClipboardPaste, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { fail, useApp } from "@/app/store";
import { AudioPlayer, Card, Field, ModelSelect, PageHeader } from "@/components/common";
import { DirectiveText } from "@/components/DirectiveText";
import { VoicePicker } from "@/components/VoicePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";

type Speaker = { name: string; voice_id: string };
type Turn = { speaker: string; text: string; style: string; directed?: boolean };

const MAX_TURNS = 24;
const MAX_TURN_CHARS = 1000;
const MAX_TOTAL = 3000;
const TAGS = ["<laugh>", "<chuckle>", "<sigh>", "<gasp>", "<whispers>", "<short pause>", "<long pause>"];

export function PodcastPage() {
  const activeProjectId = useApp((s) => s.activeProjectId);
  const [model, setModel] = useState("vox-3-studio");
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("relaxed podcast conversation");
  const [speakers, setSpeakers] = useState<Speaker[]>([
    { name: "Anna", voice_id: "Eloise" },
    { name: "Ben", voice_id: "Calvin" },
  ]);
  const [turns, setTurns] = useState<Turn[]>([
    { speaker: "Anna", text: "Welcome back to the show. Today we're talking about local AI.", style: "" },
    { speaker: "Ben", text: "Which, honestly, I didn't think would be this easy.", style: "" },
  ]);
  const [overlap, setOverlap] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState<"direct" | "render" | null>(null);
  const [undo, setUndo] = useState<{ turns: Turn[]; style: string } | null>(null);
  const [result, setResult] = useState<{ item: LibraryItem; mode: string; chars: number } | null>(null);

  const total = turns.reduce((n, t) => n + t.text.length, 0);
  const names = speakers.map((s, i) => s.name.trim() || `Speaker ${i + 1}`);
  const setTurn = (i: number, patch: Partial<Turn>) => setTurns(turns.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const applyScript = (raw: string) => {
    const lines = raw.split(/\n+/).map((l) => /^\s*([^:]{1,40}):\s*(.+)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
    if (!lines.length) return fail("Write one line per turn as Name: text.");
    const cast = [...speakers];
    const parsed: Turn[] = [];
    for (const [, who, text] of lines.slice(0, MAX_TURNS)) {
      let name = who.trim();
      if (!cast.some((s) => s.name === name)) {
        const empty = cast.find((s) => !s.name.trim());
        if (empty) empty.name = name;
        else if (cast.length < 4) cast.push({ name, voice_id: "" });
        else name = cast[0].name; // more than four voices: extras read by the first speaker
      }
      parsed.push({ speaker: name, text: text.trim(), style: "" });
    }
    setSpeakers(cast);
    setTurns(parsed);
    setPaste(null);
  };

  const autoDirect = async () => {
    setBusy("direct");
    try {
      const out = await api.direct({
        turns: turns.map((t) => ({ speaker: t.speaker, text: t.text, ...(t.style ? { style: t.style } : {}) })),
        overlap: overlap && speakers.length === 2,
      });
      setUndo({ turns, style });
      setTurns(out.turns.map((t) => ({ speaker: t.speaker, text: t.text, style: t.style ?? "", directed: t.directed })));
      if (out.style) setStyle(out.style);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const render = async () => {
    setBusy("render");
    try {
      const r = await api.podcast({
        model,
        title,
        style,
        speakers: speakers.map((s, i) => ({ name: names[i], voice_id: s.voice_id })),
        turns,
        project_id: activeProjectId,
      });
      setResult(r);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Podcast"
        subtitle="Multi-speaker dialogue on Vox 3: up to 4 speakers, 24 lines, 3,000 characters. Two stock voices render as one natural conversation."
      />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaste(paste === null ? "" : null)}>
              <ClipboardPaste /> Paste a script
            </Button>
            <Button variant="secondary" size="sm" onClick={autoDirect} disabled={!!busy || !turns.some((t) => t.text.trim())} title="Adds delivery tags and style notes without changing your words. Free.">
              {busy === "direct" ? <Loader2 className="animate-spin" /> : <Wand2 />} Auto-direct
            </Button>
            {undo && (
              <Button variant="ghost" size="sm" onClick={() => (setTurns(undo.turns), setStyle(undo.style), setUndo(null))}>
                Undo direction
              </Button>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Experimental: |reaction| bars inside a line are spoken over it by the other speaker. Two stock voices only.">
              <input type="checkbox" checked={overlap} onChange={(e) => setOverlap(e.target.checked)} disabled={speakers.length !== 2} />
              Overlapping reactions
            </label>
            <span className={`ml-auto text-[11px] ${total > MAX_TOTAL ? "text-destructive" : "text-muted-foreground"}`}>
              {total.toLocaleString()} / {MAX_TOTAL.toLocaleString()} characters · {turns.length}/{MAX_TURNS} lines
            </span>
          </div>

          {paste !== null && (
            <Card className="space-y-2">
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={"Anna: Hi and welcome!\nBen: Glad to be here."} autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPaste(null)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => applyScript(paste)}>
                  Apply script
                </Button>
              </div>
            </Card>
          )}

          {turns.map((t, i) => (
            <Card key={i} className={`space-y-2 p-3 ${t.directed ? "ring-1 ring-primary/40" : ""}`}>
              <div className="flex items-center gap-2">
                <Select value={t.speaker} onChange={(e) => setTurn(i, { speaker: e.target.value })} className="h-7 w-36">
                  {names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
                <Input value={t.style} onChange={(e) => setTurn(i, { style: e.target.value })} placeholder="Line style (optional), e.g. nervous" className="h-7 flex-1" />
                {t.directed && <Badge>directed</Badge>}
                <span className={`text-[10px] ${t.text.length > MAX_TURN_CHARS ? "text-destructive" : "text-muted-foreground"}`}>{t.text.length}</span>
                <Button variant="ghost" size="icon" onClick={() => setTurns(turns.filter((_, j) => j !== i))} title="Delete line">
                  <Trash2 />
                </Button>
              </div>
              <Textarea value={t.text} onChange={(e) => setTurn(i, { text: e.target.value })} rows={2} className="resize-y" />
              <div className="flex flex-wrap items-center gap-1">
                {TAGS.map((tag) => (
                  <button key={tag} onClick={() => setTurn(i, { text: `${t.text.trimEnd()} ${tag} ` })} className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-400/25">
                    {tag.replace(/[<>]/g, "")}
                  </button>
                ))}
                {/[<|[]/.test(t.text) && (
                  <span className="ml-2 truncate text-[11px]">
                    <DirectiveText text={t.text} />
                  </span>
                )}
              </div>
            </Card>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={turns.length >= MAX_TURNS}
            onClick={() => setTurns([...turns, { speaker: names[(names.indexOf(turns.at(-1)?.speaker ?? "") + 1) % names.length], text: "", style: "" }])}
          >
            <Plus /> Line
          </Button>

          {result && (
            <Card className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{result.item.title}</span>
                <span className="text-muted-foreground">
                  {result.chars.toLocaleString()} characters · {result.mode ?? "rendered"} mode · saved to Library
                </span>
              </div>
              <AudioPlayer src={result.item.url!} download={`${result.item.title}.mp3`} key={result.item.id} />
            </Card>
          )}
        </div>

        <Card className="h-fit space-y-4">
          <Field label="Title (for the Library)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Episode 1" />
          </Field>
          <Field label="Model">
            <ModelSelect value={model} onChange={setModel} only={["vox-3-studio", "vox-3-express"]} />
          </Field>
          <Field label="Overall style">
            <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="relaxed podcast conversation" />
          </Field>
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cast</div>
            {speakers.map((s, i) => (
              <div key={i} className="space-y-1.5 rounded-md border bg-background/40 p-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={s.name}
                    placeholder={`Speaker ${i + 1}`}
                    onChange={(e) => {
                      const old = names[i];
                      const name = e.target.value;
                      setSpeakers(speakers.map((x, j) => (j === i ? { ...x, name } : x)));
                      setTurns(turns.map((t) => (t.speaker === old ? { ...t, speaker: name.trim() || `Speaker ${i + 1}` } : t)));
                    }}
                    className="h-7"
                  />
                  {speakers.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => setSpeakers(speakers.filter((_, j) => j !== i))} title="Remove">
                      <X />
                    </Button>
                  )}
                </div>
                <VoicePicker model={model} value={s.voice_id} onChange={(id) => setSpeakers(speakers.map((x, j) => (j === i ? { ...x, voice_id: id } : x)))} />
              </div>
            ))}
            {speakers.length < 4 && (
              <Button variant="ghost" size="sm" onClick={() => setSpeakers([...speakers, { name: "", voice_id: "" }])}>
                <Plus /> Speaker
              </Button>
            )}
          </div>
          <Button
            variant="gold"
            size="lg"
            className="w-full"
            onClick={render}
            disabled={!!busy || total > MAX_TOTAL || !turns.some((t) => t.text.trim()) || speakers.some((s) => !s.voice_id)}
            data-testid="render-podcast"
          >
            {busy === "render" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Generate · {total.toLocaleString()} chars
          </Button>
        </Card>
      </div>
    </div>
  );
}
