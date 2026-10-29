// Inline directive handling shared by the server (payload translation) and the
// client (highlighting). Segment text is stored in one canonical form —
// `<sigh>`, `<laugh>`, `<short pause>` — and translated to each model's own
// syntax at render time, so the same script renders on every model.

export const VOCAL_EVENTS = ["sigh", "laugh", "chuckle", "gasp", "breathe", "cough", "sniff", "groan"];
export const PAUSES = { "short pause": 0.5, "long pause": 1.5 };

export const MODELS = {
  "vox-2-flash": {
    label: "Vox 2 Flash",
    tier: "preview",
    maxChars: 2000,
    instruction: false,
    events: "square",
    note: "Ultra-low latency. Ignores style direction; vocal events and pauses still work.",
  },
  "vox-2": {
    label: "Vox 2",
    tier: "master",
    maxChars: 2000,
    instruction: true,
    events: "square",
    note: "Flagship. Same voices as Flash, so preview casting carries over.",
  },
  "vox-3-studio": {
    label: "Vox 3 Studio",
    tier: "master",
    maxChars: 1000,
    instruction: true,
    events: "angle",
    voiceCatalog: "vox-3-studio",
    note: "Studio-grade, expressive. Own voice catalogue; 1,000 chars per segment.",
  },
  "vox-4": {
    label: "Vox 4",
    tier: "master",
    maxChars: 2000,
    instruction: false,
    events: "none",
    voiceCatalog: "vox-4",
    note: "48 kHz studio audio. Own voice catalogue; keeps pauses, drops vocal events and direction.",
  },
};

export const PREVIEW_MODEL = "vox-2-flash";
export const MASTER_MODELS = Object.keys(MODELS).filter((m) => MODELS[m].tier === "master");

// Matches `<laugh>`, `<short pause>`, `[laugh]`, `[sigh]` and `<break time="1s" />`.
const TAG_RE = /<break\s+time="[^"]*"\s*\/>|<([a-z][a-z ]{1,20})>|\[([a-z][a-z ]{1,20})\]/gi;

/** Split text into plain and directive pieces for highlighting. */
export function tokenize(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    const name = (m[1] || m[2] || "break").toLowerCase().trim();
    const kind = name === "break" || name in PAUSES ? "pause" : VOCAL_EVENTS.includes(name) ? "event" : "style";
    out.push({ type: "tag", kind, name, value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Rewrite canonical directives into the syntax `model` understands. */
export function translateText(text, model) {
  const spec = MODELS[model];
  if (!spec) throw new Error(`Unknown model ${model}`);
  const translated = tokenize(text)
    .map((t) => {
      if (t.type === "text") return t.value;
      if (t.kind === "pause") {
        if (t.name === "break") return t.value;
        const secs = PAUSES[t.name];
        if (spec.events === "angle") return `<${t.name}>`;
        if (model === "vox-4") return `<|${secs}|>`;
        return `<break time="${secs}s" />`;
      }
      if (t.kind === "event") {
        if (spec.events === "angle") return `<${t.name}>`;
        if (spec.events === "square") return `[${t.name}]`;
        return "";
      }
      // Free-form `[say this excitedly]` style cues: vox-2 only.
      return model === "vox-2" ? `[${t.name}]` : "";
    })
    .join("");
  return translated.replace(/[ \t]{2,}/g, " ").trim();
}

/** Combine a track's character direction with a segment's emotion annotation. */
export function combineInstruction(trackDirection, segmentInstruction) {
  return [trackDirection, segmentInstruction]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join("; ");
}
