import { useEffect, useState } from "react";
import { MODELS } from "@shared/directives.js";
import { useApp } from "@/app/store";
import { api } from "./api";
import type { Voice } from "./types";

// Voice catalogues, fetched once per catalogue (several models share one).
const catalogs = new Map<string, Promise<Voice[]>>();

export function voicesFor(model: string) {
  const catalog = MODELS[model]?.catalog ?? model;
  let p = catalogs.get(catalog);
  if (!p) {
    p = api.voices(model).then((r) => r.voices);
    p.catch(() => catalogs.delete(catalog));
    catalogs.set(catalog, p);
  }
  return p;
}

export function clearVoiceCatalogs() {
  catalogs.clear();
}

/** The voice list for a model; empty until loaded or when no key is saved. */
export function useVoices(model: string | null, version = 0) {
  const hasKey = useApp((s) => s.settings?.hasKey);
  const [state, setState] = useState<{ voices: Voice[]; loading: boolean; error: string | null }>({ voices: [], loading: false, error: null });
  useEffect(() => {
    if (!hasKey || !model || !MODELS[model]) return setState({ voices: [], loading: false, error: null });
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    voicesFor(model)
      .then((voices) => live && setState({ voices, loading: false, error: null }))
      .catch((err) => live && setState({ voices: [], loading: false, error: err.message }));
    return () => {
      live = false;
    };
  }, [model, hasKey, version]);
  return state;
}

/** Facet values such as gender/accent, merged with tags, for filtering. */
export function voiceFacets(v: Voice) {
  const f = v.facets ?? {};
  return {
    gender: f.gender?.[0] ?? v.tags?.find((t) => /^(male|female|neutral)$/i.test(t))?.toLowerCase() ?? null,
    language: (f.language?.[0] ?? v.languages?.[0]?.slice(0, 2) ?? "").toLowerCase() || null,
    designed: Boolean(v.tags?.includes("designed") || v.id.startsWith("dv_")),
    cloned: Boolean(v.tags?.includes("cloned") || v.id.startsWith("cv_")),
  };
}
