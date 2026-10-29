import { useEffect, useState } from "react";
import { AudioLines, BookOpen, Copy, Cpu, FileText, Library, Loader2, Mic, Podcast, Search, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { MODELS } from "@shared/directives.js";
import { fail, useApp } from "@/app/store";
import { AudioPlayer, Empty, PageHeader, formatBytes, formatDuration, timeAgo } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { LibraryItem } from "@/lib/types";

const KINDS: Record<string, { label: string; icon: JSX.Element }> = {
  speech: { label: "Speech", icon: <AudioLines /> },
  podcast: { label: "Podcast", icon: <Podcast /> },
  audiobook: { label: "Audiobook", icon: <BookOpen /> },
  transcript: { label: "Transcript", icon: <Mic /> },
  mixdown: { label: "Timeline mixdown", icon: <SlidersHorizontal /> },
  upload: { label: "Upload", icon: <Upload /> },
};

export function LibraryPage() {
  const params = useApp((s) => s.routeParams);
  const projects = useApp((s) => s.projects);
  const [project, setProject] = useState(params.get("project") ?? "all");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);

  useEffect(() => setProject(params.get("project") ?? "all"), [params]);
  const load = () =>
    api
      .library({ project, kind, q })
      .then((r) => setItems(r.items))
      .catch(fail);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [project, kind, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        title="Library"
        subtitle="Everything you generate is kept here on disk: speech, podcasts, audiobooks, transcripts and timeline mixdowns."
        actions={
          <>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and text" className="h-9 pl-8" />
            </div>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9">
              <option value="">All kinds</option>
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <Select value={project} onChange={(e) => setProject(e.target.value)} className="h-9" aria-label="Project filter">
              <option value="all">Everything</option>
              <option value="unfiled">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="space-y-2 p-6">
        {items === null ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : items.length === 0 ? (
          <Empty icon={<Library />} title="Nothing here yet">
            Generate something in the Playground; it lands here automatically, filed under the project in the sidebar.
          </Empty>
        ) : (
          items.map((it) => <LibraryRow key={it.id} item={it} onChange={load} />)
        )}
      </div>
    </div>
  );
}

function LibraryRow({ item, onChange }: { item: LibraryItem; onChange: () => void }) {
  const projects = useApp((s) => s.projects);
  const toast = useApp((s) => s.toast);
  const [title, setTitle] = useState(item.title);
  const k = KINDS[item.kind] ?? { label: item.kind, icon: <FileText /> };
  const audio = item.url && item.mime?.startsWith("audio/");
  const save = async (patch: { title?: string; project_id?: number | null }) => {
    try {
      await api.patchLibrary(item.id, patch);
      onChange();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="grid items-center gap-3 rounded-lg border bg-panel px-3 py-2.5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]" data-library-item={item.id}>
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="mt-0.5 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{k.icon}</div>
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== item.title && save({ title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full truncate bg-transparent text-[13px] font-medium outline-none focus:underline"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <Badge variant="secondary">{k.label}</Badge>
            {item.engine === "local" && (
              <Badge variant="outline">
                <Cpu className="h-2.5 w-2.5" /> local
              </Badge>
            )}
            <span>{MODELS[item.model]?.label ?? item.model}</span>
            {item.voice && <span className="max-w-48 truncate">· {item.voice}</span>}
            {item.duration_ms ? <span>· {formatDuration(item.duration_ms)}</span> : null}
            {item.chars > 0 && <span>· {item.chars.toLocaleString()} chars</span>}
            {item.bytes > 0 && <span>· {formatBytes(item.bytes)}</span>}
            <span>· {timeAgo(item.created_at)}</span>
          </div>
          {item.kind === "transcript" && item.text && <p className="mt-1 line-clamp-2 text-[12px] text-foreground/80">{item.text}</p>}
        </div>
      </div>
      <div className="min-w-0">
        {audio ? (
          <AudioPlayer src={item.url!} download={`${item.title}.${item.file?.split(".").pop()}`} />
        ) : item.url ? (
          <a href={`${item.url}?download=1`} className="text-xs text-primary hover:underline">
            Download {item.file?.split(".").pop()?.toUpperCase()}
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        {item.text && (
          <Button size="icon" variant="ghost" title="Copy text" onClick={() => (navigator.clipboard.writeText(item.text), toast("Copied", "info"))}>
            <Copy />
          </Button>
        )}
        <Select
          value={item.project_id ?? ""}
          onChange={(e) => save({ project_id: e.target.value ? Number(e.target.value) : null })}
          className="h-7 w-32 text-[11px]"
          title="Move to project"
        >
          <option value="">No project</option>
          {projects
            .filter((p) => !p.archived || p.id === item.project_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="hover:text-destructive"
          title="Delete"
          onClick={async () => {
            if (!confirm(`Delete "${item.title}"?`)) return;
            await api.deleteLibrary(item.id).catch(fail);
            onChange();
          }}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
