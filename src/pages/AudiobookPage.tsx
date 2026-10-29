import { useEffect, useState } from "react";
import { BookOpen, Download, Loader2, Pause, Play, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { MODELS } from "@shared/directives.js";
import { fail, useApp } from "@/app/store";
import { Card, Empty, Field, ModelSelect, PageHeader, formatBytes, formatDuration } from "@/components/common";
import { VoicePicker } from "@/components/VoicePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Audiobook } from "@/lib/types";

const BOOK_MODELS = ["vox-2-flash", "vox-2", "vox-3-studio", "vox-3-express"];
const STATUS_TONE: Record<string, "default" | "success" | "gold" | "secondary" | "destructive"> = {
  draft: "secondary",
  rendering: "default",
  stitching: "default",
  ready: "success",
  paused: "gold",
};

export function AudiobookPage() {
  const activeProjectId = useApp((s) => s.activeProjectId);
  const [books, setBooks] = useState<Audiobook[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () =>
    api
      .audiobooks()
      .then((r) => setBooks(r.audiobooks))
      .catch((err) => (setBooks([]), fail(err)));

  useEffect(() => void load(), []);
  // Poll while anything is rendering on voxtts.app.
  const active = books?.some((b) => b.status === "rendering" || b.status === "stitching");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div>
      <PageHeader
        title="Audiobook"
        subtitle="Whole manuscripts (up to 100,000 characters) rendered in the background on voxtts.app, with chapter markers. Finished books can be saved to the Library."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshCw /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(!creating)}>
              <Plus /> New audiobook
            </Button>
          </>
        }
      />
      <div className="space-y-4 p-6">
        {creating && (
          <NewBook
            projectId={activeProjectId}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}
        {books === null ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : books.length === 0 ? (
          <Empty icon={<BookOpen />} title="No audiobooks yet">
            Create one from a manuscript. Vox 2 Flash is the cheap option for drafts; Vox 3 needs a paid plan.
          </Empty>
        ) : (
          books.map((b) => <BookRow key={b.id} book={b} onChange={load} />)
        )}
      </div>
    </div>
  );
}

function NewBook({ projectId, onCreated }: { projectId: number | null; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("vox-2-flash");
  const [voice, setVoice] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState("");
  const [speed, setSpeed] = useState(1);
  const [magic, setMagic] = useState(false);
  const [render, setRender] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const catalog = MODELS[model].catalog;

  const create = async () => {
    setBusy(true);
    try {
      await api.createAudiobook({
        title: title || undefined,
        text,
        model,
        narrator_voice: voice[catalog],
        instruction: instruction || undefined,
        speed,
        magic,
        render,
        project_id: projectId,
      });
      onCreated();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} placeholder={"Chapter 1\n\nIt was a bright cold day in April…"} className="resize-y" />
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <label className="inline-flex cursor-pointer items-center gap-1.5 hover:text-foreground">
            <Upload className="h-3.5 w-3.5" /> Load a .txt or .md file
            <input
              type="file"
              accept=".txt,.md,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setText(await f.text());
                  if (!title) setTitle(f.name.replace(/\.\w+$/, ""));
                }
              }}
            />
          </label>
          <span className={text.length > 100_000 ? "text-destructive" : ""}>{text.length.toLocaleString()} / 100,000 characters</span>
        </div>
      </div>
      <div className="space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My book" />
        </Field>
        <Field label="Model" hint={MODELS[model].note}>
          <ModelSelect value={model} onChange={setModel} only={BOOK_MODELS} />
        </Field>
        <Field label="Narrator">
          <VoicePicker model={model} value={voice[catalog] ?? ""} onChange={(id) => setVoice({ ...voice, [catalog]: id })} />
        </Field>
        {MODELS[model].instruction && (
          <Field label="Book-wide style">
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="calm, intimate narration" />
          </Field>
        )}
        <Field label={`Speed · ${speed.toFixed(2)}×`}>
          <input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
        </Field>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={magic} onChange={(e) => setMagic(e.target.checked)} className="mt-0.5" />
          <span>
            Magic: find characters, give each a voice and direct every chapter
            <span className="block text-[11px] text-muted-foreground">Otherwise the text is only split into chapters and passages.</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={render} onChange={(e) => setRender(e.target.checked)} /> Start rendering right away
        </label>
        <Button className="w-full" onClick={create} disabled={busy || !text.trim() || !voice[catalog] || text.length > 100_000}>
          {busy ? <Loader2 className="animate-spin" /> : <BookOpen />} Create audiobook
        </Button>
        <p className="text-[11px] text-muted-foreground">Characters are spent as passages render; editing and stitching are free.</p>
      </div>
    </Card>
  );
}

function BookRow({ book, onChange }: { book: Audiobook; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useApp((s) => s.toast);
  const p = book.progress;
  const pct = p?.passages ? Math.round(((p.done + p.failed) / p.passages) * 100) : 0;

  const act = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(what);
    try {
      await fn();
      if (done) toast(done, "info");
      onChange();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{book.title || "Untitled audiobook"}</span>
        <Badge variant={STATUS_TONE[book.status] ?? "secondary"}>{book.status}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {MODELS[book.model]?.label ?? book.model} · {book.characters?.toLocaleString() ?? "?"} chars · {book.chapters?.length ?? 0} {book.chapters?.length === 1 ? "chapter" : "chapters"}
          {book.audio_seconds ? ` · ${formatDuration(book.audio_seconds * 1000)}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {(book.status === "draft" || book.status === "paused") && (
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("render", () => api.renderAudiobook(book.id))}>
              {busy === "render" ? <Loader2 className="animate-spin" /> : <Play />} {p?.done ? "Continue" : "Render"}
            </Button>
          )}
          {book.status === "rendering" && (
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("cancel", () => api.cancelAudiobook(book.id))}>
              <Pause /> Stop
            </Button>
          )}
          {book.status === "ready" &&
            Object.entries(book.files ?? {}).map(([fmt, f]) => (
              <Button
                key={fmt}
                size="sm"
                variant="outline"
                disabled={!!busy}
                title={`Download ${fmt.toUpperCase()} (${formatBytes(f.bytes)}) into the Library`}
                onClick={() => act(fmt, () => api.saveAudiobook(book.id, fmt), `${fmt.toUpperCase()} saved to the Library`)}
              >
                {busy === fmt ? <Loader2 className="animate-spin" /> : <Download />} {fmt.toUpperCase()}
              </Button>
            ))}
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={!!busy || book.status === "rendering"}
            onClick={() => confirm(`Delete "${book.title}" and its files on voxtts.app?`) && act("delete", () => api.deleteAudiobook(book.id))}
            title="Delete"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {p && p.passages > 0 && book.status !== "ready" && (
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>
              {p.done}/{p.passages} passages{p.failed ? ` · ${p.failed} failed` : ""}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {book.error && <p className="text-[11px] text-amber-300">{book.error}</p>}
    </Card>
  );
}
