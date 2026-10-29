import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Cpu, Download, ExternalLink, Heart, Loader2, Search, Terminal, Trash2, X } from "lucide-react";
import { fail, useApp } from "@/app/store";
import { Card, Empty, Field, PageHeader, formatBytes } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { HubModel, LocalModel, RuntimeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Source = "auto" | "hf" | "ms";
type Pick = { repo: string; paths?: string[]; task?: "tts" | "stt" };

const STARTERS: { title: string; blurb: string; size: string; runtime: string; pick: Pick }[] = [
  {
    title: "Piper · English (US) Lessac",
    blurb: "Fast, natural CPU voice. Hundreds more voices in 40+ languages in the same repo.",
    size: "63 MB",
    runtime: "piper",
    pick: { repo: "rhasspy/piper-voices", paths: ["en/en_US/lessac/medium/en_US-lessac-medium.onnx", "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"] },
  },
  {
    title: "Kokoro 82M",
    blurb: "Top-quality small TTS with 50+ voices (American, British, Spanish, French, Japanese…). ONNX build, no PyTorch.",
    size: "354 MB",
    runtime: "kokoro-onnx",
    pick: { repo: "fastrtc/kokoro-onnx", paths: ["kokoro-v1.0.onnx", "voices-v1.0.bin"] },
  },
  {
    title: "MMS-TTS English",
    blurb: "Meta's VITS model via transformers. 1,100+ languages exist as facebook/mms-tts-<code>.",
    size: "145 MB",
    runtime: "transformers",
    pick: { repo: "facebook/mms-tts-eng", task: "tts" },
  },
  {
    title: "faster-whisper small",
    blurb: "Whisper for CTranslate2: accurate multilingual transcription on CPU.",
    size: "485 MB",
    runtime: "faster-whisper",
    pick: { repo: "Systran/faster-whisper-small" },
  },
  {
    title: "Whisper tiny (transformers)",
    blurb: "OpenAI's smallest Whisper through transformers. Swap in any whisper-* size.",
    size: "150 MB",
    runtime: "transformers",
    pick: { repo: "openai/whisper-tiny", task: "stt" },
  },
];

export function LocalModelsPage() {
  const models = useApp((s) => s.localModels);
  const refreshLocalModels = useApp((s) => s.refreshLocalModels);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);

  const loadRuntime = () => api.runtime().then(setRuntime).catch(fail);
  useEffect(() => {
    void loadRuntime();
    void refreshLocalModels();
  }, [refreshLocalModels]);
  const busy = runtime?.install.running || models.some((m) => m.status === "downloading");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      void refreshLocalModels();
      void loadRuntime();
    }, 1500);
    return () => clearInterval(t);
  }, [busy, refreshLocalModels]);

  return (
    <div>
      <PageHeader
        title="Local models"
        subtitle="Download open-source TTS and STT models from Hugging Face, with ModelScope as a mirror, and run them on this computer. They show up as engines in Speech and Transcribe."
      />
      <div className="space-y-6 p-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Starter picks</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {STARTERS.map((s) => {
              const have = models.some((m) => m.repo_id.endsWith(s.pick.repo.split("/")[1]) && m.status === "ready");
              return (
                <Card key={s.title} className="flex flex-col gap-2 p-3">
                  <div className="text-[13px] font-medium">{s.title}</div>
                  <p className="flex-1 text-[11px] leading-snug text-muted-foreground">{s.blurb}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Badge variant="secondary">{s.runtime}</Badge> {s.size}
                  </div>
                  <Button size="sm" variant={have ? "ghost" : "outline"} onClick={() => setPick(s.pick)}>
                    {have ? <CheckCircle2 className="text-emerald-400" /> : <Download />} {have ? "Downloaded" : "Get"}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>

        <HubSearch onPick={setPick} />

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this computer</h2>
          {models.length === 0 ? (
            <Empty icon={<Cpu />} title="No local models yet">
              Pick a starter above or search the hubs. Models are stored in data/models.
            </Empty>
          ) : (
            <div className="space-y-2">
              {models.map((m) => (
                <ModelRow key={m.id} model={m} runtime={runtime} onChange={() => (refreshLocalModels(), loadRuntime())} />
              ))}
            </div>
          )}
        </section>

        <Runtimes runtime={runtime} onChange={loadRuntime} />
        <HubSettings />
      </div>
      {pick && <RepoDialog pick={pick} onClose={() => setPick(null)} onStarted={() => (setPick(null), refreshLocalModels())} />}
    </div>
  );
}

function HubSearch({ onPick }: { onPick: (p: Pick) => void }) {
  const [task, setTask] = useState<"tts" | "stt">("tts");
  const [source, setSource] = useState<Source>("auto");
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ source: "hf" | "ms"; models: HubModel[]; fallback?: string } | null>(null);

  const search = async () => {
    setBusy(true);
    try {
      setOut(await api.searchHub({ q, task, source }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Find a model</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5 text-[11px]">
          {(["tts", "stt"] as const).map((t) => (
            <button key={t} onClick={() => setTask(t)} className={cn("rounded px-2.5 py-1", task === t ? "bg-primary text-white" : "text-muted-foreground")}>
              {t === "tts" ? "Text to speech" : "Speech to text"}
            </button>
          ))}
        </div>
        <Select value={source} onChange={(e) => setSource(e.target.value as Source)} className="h-8">
          <option value="auto">Hugging Face → ModelScope</option>
          <option value="hf">Hugging Face only</option>
          <option value="ms">ModelScope only</option>
        </Select>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={task === "tts" ? "piper, kokoro, mms-tts…" : "whisper, wav2vec2…"} className="pl-8" data-testid="hub-search" />
        </div>
        <Button size="sm" onClick={search} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
        <span className="mx-1 text-[11px] text-muted-foreground">or</span>
        <Input value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && repo.includes("/") && onPick({ repo: repo.trim(), task })} placeholder="owner/repo" className="w-52 font-mono" />
        <Button size="sm" variant="outline" disabled={!repo.includes("/")} onClick={() => onPick({ repo: repo.trim(), task })}>
          Open repo
        </Button>
      </div>
      {out && (
        <Card className="p-2">
          <div className="px-2 pb-2 text-[11px] text-muted-foreground">
            {out.models.length} results from {out.source === "hf" ? "Hugging Face" : "ModelScope"}
            {out.fallback && <span className="text-amber-300"> · Hugging Face unavailable ({out.fallback}), showing the ModelScope mirror</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {out.models.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px]">{m.id}</div>
                  <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {m.library && <Badge variant="secondary">{m.library}</Badge>}
                    {m.tags.slice(0, 5).map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </div>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Download className="h-3 w-3" /> {m.downloads.toLocaleString()}
                </span>
                <span className="flex w-14 items-center gap-1 text-[10px] text-muted-foreground">
                  <Heart className="h-3 w-3" /> {m.likes.toLocaleString()}
                </span>
                <a
                  href={out.source === "hf" ? `https://huggingface.co/${m.id}` : `https://www.modelscope.cn/models/${m.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  title="Model card"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <Button size="sm" variant="outline" onClick={() => onPick({ repo: m.id, task })}>
                  Choose files
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

function RepoDialog({ pick, onClose, onStarted }: { pick: Pick; onClose: () => void; onStarted: () => void }) {
  const [source, setSource] = useState<Source>("auto");
  const [listing, setListing] = useState<Awaited<ReturnType<typeof api.repoFiles>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [adapter, setAdapter] = useState("");
  const [task, setTask] = useState<string>("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setListing(null);
    setError(null);
    api
      .repoFiles({ repo: pick.repo, source, task: pick.task })
      .then((l) => {
        setListing(l);
        const big = l.files.length > 300;
        setSelected(new Set(pick.paths?.filter((p) => l.files.some((f) => f.path === p)) ?? (big ? [] : l.suggested)));
        if (big && !pick.paths) setFilter("");
      })
      .catch((err) => setError(err.message));
  }, [pick, source]);

  const files = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (listing?.files ?? []).filter((x) => !f || x.path.toLowerCase().includes(f));
  }, [listing, filter]);
  const total = (listing?.files ?? []).filter((f) => selected.has(f.path)).reduce((n, f) => n + f.size, 0);
  const toggle = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelected(next);
  };

  const start = async () => {
    setBusy(true);
    try {
      // The search tab's task is only a hint, and only matters for transformers repos (which can do either).
      const hint = listing!.detected.adapter === "transformers" ? pick.task : undefined;
      await api.downloadModel({
        repo: pick.repo,
        source: listing!.source,
        paths: [...selected],
        adapter: adapter || undefined,
        task: task || hint,
        name: name || undefined,
      });
      onStarted();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-[13px]">{pick.repo}</DialogTitle>
          <DialogDescription>
            {listing ? (
              <>
                {listing.files.length} files on {listing.source === "hf" ? "Hugging Face" : `ModelScope (${listing.repo})`}.
                {listing.fallback && <span className="text-amber-300"> Hugging Face failed ({listing.fallback}); using the ModelScope mirror.</span>}{" "}
                Detected runtime: <b>{listing.detected.adapter}</b> · {listing.detected.task.toUpperCase()}.
              </>
            ) : error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              "Listing files…"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={source} onChange={(e) => setSource(e.target.value as Source)} className="h-8">
            <option value="auto">Hugging Face → ModelScope</option>
            <option value="hf">Hugging Face</option>
            <option value="ms">ModelScope</option>
          </Select>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files, e.g. en_US/amy" className="h-8 w-60" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(listing?.suggested ?? []))}>
            Suggested
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set([...selected, ...files.map((f) => f.path)]))} disabled={!filter}>
            Select shown
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            None
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {!listing && !error && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />}
          {files.slice(0, 500).map((f) => (
            <label key={f.path} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-[11px] last:border-0 hover:bg-accent/40">
              <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} />
              <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
              <span className="text-muted-foreground">{formatBytes(f.size)}</span>
            </label>
          ))}
          {files.length > 500 && <p className="p-2 text-center text-[11px] text-muted-foreground">Showing 500 of {files.length}. Type a filter to narrow it down.</p>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Runtime">
            <Select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="w-full">
              <option value="">Auto-detect</option>
              <option value="piper">Piper</option>
              <option value="kokoro-onnx">Kokoro (ONNX)</option>
              <option value="kokoro">Kokoro (PyTorch)</option>
              <option value="transformers">Transformers</option>
              <option value="faster-whisper">faster-whisper</option>
            </Select>
          </Field>
          <Field label="Task">
            <Select value={task} onChange={(e) => setTask(e.target.value)} className="w-full">
              <option value="">Auto-detect</option>
              <option value="tts">Text to speech</option>
              <option value="stt">Speech to text</option>
            </Select>
          </Field>
          <Field label="Local name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="auto" />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} files · {formatBytes(total)}
          </span>
          <Button className="ml-auto" onClick={start} disabled={busy || !listing || !selected.size} data-testid="start-download">
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelRow({ model: m, runtime, onChange }: { model: LocalModel; runtime: RuntimeStatus | null; onChange: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const pct = m.bytes_total ? Math.round((m.bytes_done / m.bytes_total) * 100) : 0;
  const rt = runtime?.adapters[m.adapter];
  const patch = async (b: { adapter?: string; task?: string }) => {
    await api.patchModel(m.id, b).catch(fail);
    onChange();
  };
  return (
    <Card className="space-y-2 p-3" data-model={m.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px]">{m.id}</span>
        <Badge variant={m.status === "ready" ? "success" : m.status === "downloading" ? "default" : "destructive"}>{m.status}</Badge>
        <Badge variant="outline">{m.source === "hf" ? "Hugging Face" : "ModelScope"}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {m.files.length} files · {formatBytes(m.bytes_total)}
          {m.voices.length ? ` · ${m.voices.length} voices` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={m.task} onChange={(e) => patch({ task: e.target.value })} className="h-7 text-[11px]">
            <option value="tts">TTS</option>
            <option value="stt">STT</option>
          </Select>
          <Select value={m.adapter} onChange={(e) => patch({ adapter: e.target.value })} className="h-7 text-[11px]">
            <option value="piper">Piper</option>
            <option value="kokoro-onnx">Kokoro (ONNX)</option>
            <option value="kokoro">Kokoro (PyTorch)</option>
            <option value="transformers">Transformers</option>
            <option value="faster-whisper">faster-whisper</option>
            <option value="unsupported">No runtime</option>
          </Select>
          {m.status === "ready" && rt?.installed && (
            <Button size="sm" variant="outline" onClick={() => navigate(m.task === "tts" ? "speech" : "transcribe")}>
              Use
            </Button>
          )}
          {m.status === "downloading" ? (
            <Button size="icon" variant="ghost" title="Cancel" onClick={async () => (await api.cancelModel(m.id).catch(fail), onChange())}>
              <X />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="hover:text-destructive"
              title="Delete from disk"
              onClick={async () => {
                if (!confirm(`Delete ${m.id} (${formatBytes(m.bytes_total)}) from disk?`)) return;
                await api.deleteModel(m.id).catch(fail);
                onChange();
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {m.status === "downloading" && (
        <div>
          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
            <span>
              {formatBytes(m.bytes_done)} of {formatBytes(m.bytes_total)}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {m.error && <p className="text-[11px] text-destructive">{m.error}</p>}
      {m.status === "ready" && m.adapter !== "unsupported" && rt && !rt.installed && (
        <p className="text-[11px] text-amber-300">Install the {rt.label} runtime below to use this model.</p>
      )}
      {m.adapter === "unsupported" && <p className="text-[11px] text-amber-300">No runtime recognised these files. Pick one above if you know which fits.</p>}
    </Card>
  );
}

function Runtimes({ runtime, onChange }: { runtime: RuntimeStatus | null; onChange: () => void }) {
  const [showLog, setShowLog] = useState(false);
  if (!runtime) return null;
  const install = async (adapter: string) => {
    try {
      await api.installRuntime(adapter);
      setShowLog(true);
      onChange();
    } catch (err) {
      fail(err);
    }
  };
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Runtimes</h2>
      <Card className="space-y-3">
        <p className="text-[12px] text-muted-foreground">
          {runtime.python ? (
            <>
              Python {runtime.python.version} found (<code>{runtime.python.command}</code>). Packages install into a private environment in data/runtime, so your system
              Python is never touched.
            </>
          ) : (
            <span className="text-amber-300">Python 3.9+ was not found. Install it from python.org, then restart Vox Studio.</span>
          )}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(runtime.adapters).map(([k, a]) => (
            <div key={k} className="flex items-start gap-3 rounded-md border bg-background/40 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {a.label}
                  {a.tasks.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t.toUpperCase()}
                    </Badge>
                  ))}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">{a.note}</p>
              </div>
              {a.installed ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> installed
                </span>
              ) : (
                <Button size="sm" variant="outline" disabled={!runtime.python || runtime.install.running} onClick={() => install(k)} data-install={k}>
                  {runtime.install.running && runtime.install.adapter === k ? <Loader2 className="animate-spin" /> : <Download />} Install
                </Button>
              )}
            </div>
          ))}
        </div>
        {(runtime.install.running || runtime.install.log.length > 0) && (
          <div>
            <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowLog(!showLog)}>
              <Terminal className="h-3.5 w-3.5" />
              {runtime.install.running ? `Installing ${runtime.install.adapter}…` : runtime.install.error ? `Install failed: ${runtime.install.error}` : `Last install: ${runtime.install.adapter} finished`}
              <span className="underline">{showLog ? "hide log" : "show log"}</span>
            </button>
            {showLog && (
              <pre className="mt-2 max-h-56 overflow-auto rounded bg-background p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{runtime.install.log.join("\n")}</pre>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}

function HubSettings() {
  const [hub, setHub] = useState<Awaited<ReturnType<typeof api.hub>> | null>(null);
  const [token, setToken] = useState("");
  const [hf, setHf] = useState("");
  const [ms, setMs] = useState("");
  useEffect(() => {
    api
      .hub()
      .then((h) => (setHub(h), setHf(h.hfEndpoint), setMs(h.msEndpoint)))
      .catch(() => {});
  }, []);
  if (!hub) return null;
  return (
    <details className="rounded-lg border bg-panel p-4">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hub settings</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Field label="Hugging Face token" hint={hub.hasHfToken ? "Saved. Raises rate limits and unlocks gated models." : "Optional. Raises rate limits and unlocks gated models."}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={hub.hasHfToken ? "••••••••" : "hf_…"} />
        </Field>
        <Field label="Hugging Face endpoint" hint="e.g. https://hf-mirror.com">
          <Input value={hf} onChange={(e) => setHf(e.target.value)} className="font-mono" />
        </Field>
        <Field label="ModelScope endpoint">
          <Input value={ms} onChange={(e) => setMs(e.target.value)} className="font-mono" />
        </Field>
      </div>
      <Button
        size="sm"
        className="mt-3"
        onClick={async () => {
          try {
            setHub(await api.saveHub({ ...(token ? { hfToken: token } : {}), hfEndpoint: hf, msEndpoint: ms }));
            setToken("");
            useApp.getState().toast("Hub settings saved", "info");
          } catch (err) {
            fail(err);
          }
        }}
      >
        Save
      </Button>
    </details>
  );
}
