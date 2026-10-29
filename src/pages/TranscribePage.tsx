import { useState } from "react";
import { Copy, Cpu, FileAudio, Loader2, Mic } from "lucide-react";
import { fail, useApp, useReadyLocalModels } from "@/app/store";
import { AudioPlayer, Card, Field, PageHeader, formatBytes, formatDuration } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { saveText, toSpeechWav, toSrt } from "@/lib/wav";

type Result = Awaited<ReturnType<typeof api.transcribe>>;

export function TranscribePage() {
  const localModels = useReadyLocalModels("stt");
  const activeProjectId = useApp((s) => s.activeProjectId);
  const toast = useApp((s) => s.toast);
  const [engine, setEngine] = useState("cloud");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("");
  const [prompts, setPrompts] = useState("");
  const [words, setWords] = useState(true);
  const [diarization, setDiarization] = useState(false);
  const [profile, setProfile] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const local = engine.startsWith("local:");

  const run = async () => {
    if (!file) return;
    setResult(null);
    try {
      let body: Blob = file;
      if (local) {
        setBusy("Converting to 16 kHz WAV…");
        body = await toSpeechWav(file);
      } else if (file.size > 15 * 1024 * 1024) throw new Error("The VoxTTS API accepts files up to 15 MB. Use a local model for larger files.");
      setBusy(local ? "Transcribing on this computer…" : "Transcribing…");
      setResult(
        await api.transcribe(body, {
          engine,
          filename: file.name,
          language,
          project_id: activeProjectId,
          word_timestamps: words,
          ...(local ? {} : { prompts, diarization, voice_profile: profile }),
        }),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const item: LibraryItem | undefined = result?.item;
  const base = file?.name.replace(/\.\w+$/, "") ?? "transcript";

  return (
    <div>
      <PageHeader title="Transcribe" subtitle="Speech to text with VoxTTS (vox-stt-1, billed per minute) or a local model such as Whisper, free and offline." />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <label
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-panel px-6 py-10 text-center hover:border-primary/60",
              dragging && "border-primary bg-primary/5",
            )}
          >
            <FileAudio className="h-6 w-6 text-muted-foreground" />
            {file ? (
              <span className="text-sm font-medium">
                {file.name} <span className="text-muted-foreground">· {formatBytes(file.size)}</span>
              </span>
            ) : (
              <span className="text-sm">Drop an audio file here or click to choose</span>
            )}
            <span className="text-[11px] text-muted-foreground">MP3, WAV, M4A, OGG, FLAC, WebM</span>
            <input type="file" accept="audio/*,video/webm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="audio-file" />
          </label>

          {result && (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">Transcript</span>
                <span className="text-muted-foreground">
                  {result.result.language ? `${result.result.language} · ` : ""}
                  {formatDuration(result.result.audio_ms)} of audio · {(result.ms / 1000).toFixed(1)} s · saved to Library
                </span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => (navigator.clipboard.writeText(result.result.text), toast("Copied", "info"))}>
                    <Copy /> Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => saveText(`${base}.txt`, result.result.text)}>
                    .txt
                  </Button>
                  {result.result.words.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => saveText(`${base}.srt`, toSrt(result.result.words), "application/x-subrip")}>
                      .srt
                    </Button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed" data-testid="transcript">
                {result.result.text || <span className="text-muted-foreground">No speech found.</span>}
              </p>
              {item?.url && <AudioPlayer src={item.url} />}
              {result.result.words.length > 0 && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Word timings ({result.result.words.length})</summary>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.result.words.map((w, i) => (
                      <span key={i} className="rounded bg-secondary px-1 py-0.5" title={`${w.start_ms}–${w.end_ms} ms${w.speaker != null ? ` · speaker ${w.speaker}` : ""}`}>
                        {w.word}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}
        </div>

        <Card className="h-fit space-y-4">
          <Field label="Engine">
            <Select value={engine} onChange={(e) => setEngine(e.target.value)} className="w-full" data-testid="stt-engine">
              <option value="cloud">VoxTTS cloud (vox-stt-1)</option>
              {localModels.map((m) => (
                <option key={m.id} value={`local:${m.id}`}>
                  Local · {m.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" hint="A hint like en or en-US. Leave empty to detect.">
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="auto" />
          </Field>
          {!local && (
            <Field label="Domain words" hint="Comma-separated names or jargon the model would otherwise mishear.">
              <Input value={prompts} onChange={(e) => setPrompts(e.target.value)} placeholder="VoxTTS, Kokoro" />
            </Field>
          )}
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={words} onChange={(e) => setWords(e.target.checked)} /> Word timestamps (enables .srt)
            </label>
            {!local && (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={diarization} onChange={(e) => setDiarization(e.target.checked)} /> Speaker diarization
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={profile} onChange={(e) => setProfile(e.target.checked)} /> Voice profile (age, emotion)
                </label>
              </>
            )}
          </div>
          <Button className="w-full" size="lg" onClick={run} disabled={!file || !!busy} data-testid="transcribe">
            {busy ? <Loader2 className="animate-spin" /> : local ? <Cpu /> : <Mic />}
            {busy ?? "Transcribe"}
          </Button>
          {!localModels.length && (
            <p className="text-[11px] text-muted-foreground">
              Want free, offline transcription? Download a Whisper model in{" "}
              <a href="#/models" className="text-primary hover:underline">
                Local models
              </a>
              .
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
