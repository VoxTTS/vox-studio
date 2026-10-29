import { useEffect, useRef, useState } from "react";
import { Cpu, Loader2, Sparkles } from "lucide-react";
import { MODELS, PAUSES, VOCAL_EVENTS, translateText } from "@shared/directives.js";
import { fail, useApp, useReadyLocalModels } from "@/app/store";
import { AudioPlayer, Card, Field, ModelSelect, PageHeader, timeAgo } from "@/components/common";
import { DirectiveText } from "@/components/DirectiveText";
import { VoicePicker } from "@/components/VoicePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";
import { useVoices } from "@/lib/voices";

const STYLE_PRESETS = ["warm, conversational", "calm narrator", "excited, fast", "whisper, conspiratorial", "sad, quiet", "news anchor"];

function remember<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`vox-studio:speech:${key}`);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(`vox-studio:speech:${key}`, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
    },
  ];
}

export function SpeechPage() {
  const params = useApp((s) => s.routeParams);
  const localModels = useReadyLocalModels("tts");
  const activeProjectId = useApp((s) => s.activeProjectId);
  const [engine, setEngine] = remember("engine", "cloud");
  const [model, setModel] = remember("model", "vox-2");
  const [voice, setVoice] = remember<Record<string, string>>("voice", {});
  const [text, setText] = remember("text", "Welcome to VoxTTS Studio. <short pause> Type anything, pick a voice, and press Generate.");
  const [instruction, setInstruction] = useState("");
  const [speed, setSpeed] = useState(1);
  const [delivery, setDelivery] = useState("balanced");
  const [language, setLanguage] = useState("");
  const [localVoice, setLocalVoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ item: LibraryItem; note: string } | null>(null);
  const [recent, setRecent] = useState<LibraryItem[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Deep link from the Voices tab: #/speech?model=…&voice=…
  useEffect(() => {
    const m = params.get("model");
    const v = params.get("voice");
    if (m && MODELS[m]) {
      setEngine("cloud");
      setModel(m);
      if (v) setVoice({ ...voice, [MODELS[m].catalog]: v });
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecent = () => api.library({ kind: "speech" }).then((r) => setRecent(r.items.slice(0, 6))).catch(() => {});
  useEffect(() => void loadRecent(), []);

  const local = engine.startsWith("local:") ? localModels.find((m) => `local:${m.id}` === engine) : undefined;
  const spec = MODELS[model];
  const voiceId = voice[spec?.catalog ?? model] ?? "";
  const { voices: catalog } = useVoices(local ? null : model);
  // First visit to a model: start on its first catalogue voice (Ashley on Vox 2) rather than nothing.
  useEffect(() => {
    if (!local && !voiceId && catalog.length) setVoice({ ...voice, [spec.catalog]: (catalog.find((v) => v.id === "Ashley") ?? catalog[0]).id });
  }, [catalog, voiceId, local]); // eslint-disable-line react-hooks/exhaustive-deps
  const spoken = local ? text : translateText(text, model);
  const chunks = local ? 1 : Math.ceil(spoken.length / spec.maxChars);

  const insert = (tag: string) => {
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    setText(`${before}${pad}${tag} ${text.slice(end).replace(/^\s+/, "")}`);
    requestAnimationFrame(() => el?.focus());
  };

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.speech(
        local
          ? { engine, text, voice_id: localVoice, speed, project_id: activeProjectId }
          : { engine: "cloud", text, model, voice_id: voiceId, instruction, speed, delivery, language, project_id: activeProjectId },
      );
      const note = local
        ? `Rendered locally in ${(r.ms / 1000).toFixed(1)} s · no characters used`
        : r.cached
          ? "Served from the local cache · 0 characters billed"
          : `${r.chars.toLocaleString()} characters billed${r.chunks && r.chunks > 1 ? ` · ${r.chunks} chunks joined` : ""} · ${(r.ms / 1000).toFixed(1)} s`;
      setResult({ item: r.item, note });
      loadRecent();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Speech" subtitle="Text to speech on VoxTTS cloud models or on open-source models running on this machine." />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <Textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && generate()}
              rows={10}
              className="resize-y text-sm"
              placeholder="Type or paste the text to speak…"
              data-testid="speech-text"
            />
            {!local && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</span>
                {[...VOCAL_EVENTS.map((e) => `<${e}>`), ...Object.keys(PAUSES).map((p) => `<${p}>`)].map((t) => (
                  <button
                    key={t}
                    onClick={() => insert(t)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${t.includes("pause") ? "bg-sky-400/10 text-sky-300 hover:bg-sky-400/25" : "bg-amber-400/10 text-amber-300 hover:bg-amber-400/25"}`}
                  >
                    {t.replace(/[<>]/g, "")}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{text.length.toLocaleString()} characters</span>
              {!local && spoken !== text && <span>· sent as {spoken.length.toLocaleString()} after tag translation</span>}
              {chunks > 1 && <Badge variant="secondary">{chunks} requests of ≤ {spec.maxChars}</Badge>}
              <Button className="ml-auto" size="lg" onClick={generate} disabled={busy || !text.trim() || (!local && !voiceId)} data-testid="generate">
                {busy ? <Loader2 className="animate-spin" /> : local ? <Cpu /> : <Sparkles />}
                Generate
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="space-y-2" >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{result.item.title}</span>
                <span className="text-muted-foreground">{result.note}</span>
              </div>
              <AudioPlayer src={result.item.url!} download={`${result.item.title}.${result.item.file?.split(".").pop()}`} key={result.item.id} />
            </Card>
          )}

          {!local && text.trim() && (
            <Card>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reads as</div>
              <div className="text-[13px] leading-relaxed">
                <DirectiveText text={text} />
              </div>
            </Card>
          )}

          {recent.length > 0 && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</div>
              <div className="space-y-2">
                {recent.map((it) => (
                  <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 rounded-md border bg-panel/60 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{it.title}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {it.engine === "local" ? `local · ${it.model}` : `${MODELS[it.model]?.label ?? it.model} · ${it.voice}`} · {timeAgo(it.created_at)}
                      </div>
                    </div>
                    <AudioPlayer src={it.url!} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Card className="h-fit space-y-4">
          <Field label="Engine">
            <Select value={local ? engine : "cloud"} onChange={(e) => setEngine(e.target.value)} className="w-full" data-testid="engine">
              <option value="cloud">VoxTTS cloud</option>
              {localModels.map((m) => (
                <option key={m.id} value={`local:${m.id}`}>
                  Local · {m.id}
                </option>
              ))}
            </Select>
          </Field>

          {local ? (
            <>
              {local.voices.length > 0 && (
                <Field label="Voice / speaker">
                  <Select value={localVoice} onChange={(e) => setLocalVoice(e.target.value)} className="w-full">
                    <option value="">Default</option>
                    {local.voices.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={`Speed · ${speed.toFixed(2)}×`}>
                <input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
              </Field>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Runs on this computer with the {local.adapter} runtime. Free and offline; tags are read as plain text.
              </p>
            </>
          ) : (
            <>
              <Field label="Model" hint={spec?.note}>
                <ModelSelect value={model} onChange={setModel} />
              </Field>
              <Field label="Voice">
                <VoicePicker model={model} value={voiceId} onChange={(id) => setVoice({ ...voice, [spec.catalog]: id })} />
              </Field>
              {spec.instruction && (
                <Field label="Style direction">
                  <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. warm, conversational" />
                  <div className="flex flex-wrap gap-1">
                    {STYLE_PRESETS.map((p) => (
                      <button key={p} onClick={() => setInstruction(p)} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                        {p}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              {spec.speed && (
                <Field label={`Speed · ${speed.toFixed(2)}×`}>
                  <input type="range" min={0.5} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="accent-[hsl(var(--primary))]" />
                </Field>
              )}
              {(model === "vox-2" || model === "vox-2-flash") && (
                <Field label="Delivery">
                  <Select value={delivery} onChange={(e) => setDelivery(e.target.value)} className="w-full">
                    <option value="stable">Stable</option>
                    <option value="balanced">Balanced</option>
                    <option value="creative">Creative</option>
                  </Select>
                </Field>
              )}
              {["vox-2", "vox-2-flash", "vox-2.5", "vox-3.5"].includes(model) && (
                <Field label="Language" hint="BCP-47, e.g. en-US or fr. Usually auto-detected.">
                  <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="auto" />
                </Field>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
