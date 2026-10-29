/** Decode any browser-playable audio and re-encode it as 16 kHz mono 16-bit WAV for local recognisers. */
export async function toSpeechWav(file: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + mono.length * 2));
    const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    view.setUint32(4, 36 + mono.length * 2, true);
    str(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, mono.length * 2, true);
    for (let i = 0; i < mono.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 0x7fff, true);
    return new Blob([view], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

type Word = { word: string; start_ms: number; end_ms: number };

/** Subtitles from word timestamps: cues of up to ~7 words or 3.5 s. */
export function toSrt(words: Word[]) {
  const cues: Word[][] = [];
  for (const w of words) {
    const cur = cues.at(-1);
    if (!cur || cur.length >= 7 || w.end_ms - cur[0].start_ms > 3500 || /[.!?]$/.test(cur.at(-1)!.word)) cues.push([w]);
    else cur.push(w);
  }
  const ts = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c[0].start_ms)} --> ${ts(c.at(-1)!.end_ms)}\n${c.map((w) => w.word).join(" ")}\n`).join("\n");
}

export function saveText(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
