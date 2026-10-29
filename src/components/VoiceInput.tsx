import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Voice } from "@/lib/types";

const catalogs = new Map<string, Promise<Voice[]>>();

function voicesFor(model: string) {
  let p = catalogs.get(model);
  if (!p) {
    p = api.voices(model).then((r) => r.voices);
    p.catch(() => catalogs.delete(model));
    catalogs.set(model, p);
  }
  return p;
}

export function clearVoiceCatalogs() {
  catalogs.clear();
}

/** Free-text voice id with suggestions from the model's catalogue (when a key is saved). */
export function VoiceInput({
  model,
  value,
  placeholder,
  onCommit,
}: {
  model: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const hasKey = useStore((s) => s.settings?.hasKey);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [draft, setDraft] = useState(value);
  const listId = useId();

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!hasKey) return;
    let live = true;
    voicesFor(model)
      .then((v) => live && setVoices(v))
      .catch(() => live && setVoices([]));
    return () => {
      live = false;
    };
  }, [model, hasKey]);

  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  const match = voices.find((v) => v.id === draft);

  return (
    <div>
      <Input
        list={listId}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="font-mono"
      />
      <datalist id={listId}>
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name !== v.id ? `${v.name} — ` : ""}
            {v.description ?? ""}
          </option>
        ))}
      </datalist>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {match?.description ??
          (voices.length ? `${voices.length} voices in catalogue` : hasKey ? "Loading catalogue…" : "Add an API key to browse voices")}
      </p>
    </div>
  );
}
