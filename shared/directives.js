// Model capabilities and inline directive handling, shared by the server
// (payload translation) and the client (highlighting, warnings). Text is
// written in one canonical form — `<sigh>`, `<laugh>`, `<short pause>` — and
// translated to each model's own syntax at render time (see /docs on voxtts.app).

export const VOCAL_EVENTS = ["sigh", "laugh", "chuckle", "gasp", "breathe", "cough", "sniff", "groan", "whispers"];
export const PAUSES = { "short pause": 0.5, "long pause": 1.5 };

// events: how vocal events are written — "square" [laugh], "angle" <laugh>,
//   "laughter" (only [laughter]), "none".
// pause:  "break" <break time="1s" />, "angle" <short pause>, "bar" <|1|>, "none".
// catalog: the ?model= value for GET /api/v1/voices (models sharing one list share a value).
export const MODELS = {
  "vox-2-flash": {
    label: "Vox 2 Flash",
    tier: "preview",
    maxChars: 2000,
    instruction: false,
    speed: true,
    events: "square",
    pause: "break",
    catalog: "vox-2",
    note: "Ultra-low latency, half the quota. Ignores style direction; vocal events and pauses still work.",
  },
  "vox-2": {
    label: "Vox 2",
    tier: "master",
    maxChars: 2000,
    instruction: true,
    speed: true,
    events: "square",
    pause: "break",
    catalog: "vox-2",
    note: "Flagship. Style direction, emphasis, pauses and pronunciation control.",
  },
  "vox-2.5": {
    label: "Vox 2.5",
    tier: "master",
    maxChars: 2000,
    instruction: false,
    speed: true,
    events: "square",
    pause: "none",
    catalog: "vox-2.5",
    note: "Lifelike voices in 80+ languages, directed with inline cues like [laughing] or [whispering].",
  },
  "vox-3-studio": {
    label: "Vox 3 Studio",
    tier: "master",
    maxChars: 1000,
    instruction: true,
    speed: false,
    events: "angle",
    pause: "angle",
    catalog: "vox-3-studio",
    dialogue: true,
    note: "Studio-grade, expressive. Own voice catalogue; 1,000 characters per request.",
  },
  "vox-3-express": {
    label: "Vox 3 Express",
    tier: "master",
    maxChars: 1000,
    instruction: true,
    speed: false,
    events: "angle",
    pause: "angle",
    catalog: "vox-3-studio",
    dialogue: true,
    note: "Lighter, cheaper Vox 3 for high-volume narration. Counts half on Pro and Scale.",
  },
  "vox-3.1": {
    label: "Vox 3.1",
    tier: "master",
    maxChars: 2000,
    instruction: false,
    speed: true,
    events: "none",
    pause: "none",
    catalog: "vox-3.1",
    note: "Clear conversational English in many accents. Reads plain text: tags are dropped.",
  },
  "vox-3.5": {
    label: "Vox 3.5",
    tier: "master",
    maxChars: 2000,
    instruction: false,
    speed: true,
    events: "laughter",
    pause: "break",
    catalog: "vox-3.5",
    note: "Fast, expressive, many languages. Pauses and [laughter]; set the language to match the text.",
  },
  "vox-4": {
    label: "Vox 4",
    tier: "master",
    maxChars: 2000,
    instruction: false,
    speed: false,
    events: "none",
    pause: "bar",
    catalog: "vox-4",
    note: "48 kHz studio audio at low latency. Keeps pauses, drops vocal events and direction.",
  },
};

export const PREVIEW_MODEL = "vox-2-flash";
export const ALL_MODELS = Object.keys(MODELS);
export const MASTER_MODELS = ALL_MODELS.filter((m) => MODELS[m].tier === "master");

// Matches `<laugh>`, `<short pause>`, `[laugh]`, `[sigh]` and `<break time="1s" />`.
const TAG_RE = /<break\s+time="[^"]*"\s*\/>|<([a-z][a-z -]{1,20})>|\[([a-z][a-z -]{1,24})\]/gi;

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

function pauseFor(spec, name, value) {
  const secs = name === "break" ? Number(/time="([\d.]+)s?"/.exec(value)?.[1] ?? 0.5) : PAUSES[name];
  switch (spec.pause) {
    case "angle":
      return name === "break" ? (secs >= 1 ? "<long pause>" : "<short pause>") : `<${name}>`;
    case "break":
      return `<break time="${secs}s" />`;
    case "bar":
      return `<|${secs}|>`;
    default:
      return " ";
  }
}

/** Rewrite canonical directives into the syntax `model` understands. */
export function translateText(text, model) {
  const spec = MODELS[model];
  if (!spec) throw new Error(`Unknown model ${model}`);
  const translated = tokenize(text)
    .map((t) => {
      if (t.type === "text") return t.value;
      if (t.kind === "pause") return pauseFor(spec, t.name, t.value);
      if (t.kind === "event") {
        if (spec.events === "angle") return `<${t.name}>`;
        if (spec.events === "square") return `[${t.name}]`;
        if (spec.events === "laughter") return /laugh|chuckle/.test(t.name) ? "[laughter]" : "";
        return "";
      }
      // Free-form `[say this excitedly]` style cues: vox-2 and vox-2.5 only.
      return model === "vox-2" || model === "vox-2.5" ? `[${t.name}]` : "";
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
