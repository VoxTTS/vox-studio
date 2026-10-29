import { editorApi as api } from "./api";
import { audibleTracks, segmentDuration, useStore } from "./store";
import type { Timeline, Segment, Tier } from "./types";

// One AudioContext for the session; decoded buffers are kept by content hash,
// which is also the disk-cache key, so a buffer can never go stale.
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
let active: AudioBufferSourceNode[] = [];
let oneShot: AudioBufferSourceNode | null = null;
let raf = 0;
let token = 0;

function context() {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function load(hash: string): Promise<AudioBuffer> {
  let p = buffers.get(hash);
  if (!p) {
    p = fetch(`/api/audio/${hash}.mp3`)
      .then((r) => {
        if (!r.ok) throw new Error(`Audio ${hash} is not in the cache`);
        return r.arrayBuffer();
      })
      .then((data) => context().decodeAudioData(data))
      .then((buf) => {
        reportDuration(hash, buf.duration * 1000);
        return buf;
      });
    p.catch(() => buffers.delete(hash));
    buffers.set(hash, p);
  }
  return p;
}

function reportDuration(hash: string, ms: number) {
  const { timeline, setDuration } = useStore.getState();
  const known = timeline?.segments.some(
    (s) => (s.preview_hash === hash && s.preview_duration_ms) || (s.master_hash === hash && s.master_duration_ms),
  );
  if (known) return;
  setDuration(hash, Math.round(ms));
  void api.reportDuration(hash, ms).catch(() => {});
}

/** Rendered audio to hear for a segment under the current monitor; master falls back to preview. */
export function hashFor(s: Segment, monitor: Tier): string | null {
  if (monitor === "master" && s.master_ready) return s.master_hash;
  if (s.preview_ready) return s.preview_hash;
  if (s.master_ready) return s.master_hash;
  return null;
}

function stopSources() {
  for (const src of active) {
    try {
      src.stop();
    } catch {
      // already stopped
    }
  }
  active = [];
  cancelAnimationFrame(raf);
}

export const audio = {
  load,

  /** Decode cached files whose length the server does not know yet, so blocks get their real width. */
  async measureMissing(timeline: Timeline) {
    const hashes = timeline.segments.flatMap((s) => [
      ...(s.preview_ready && !s.preview_duration_ms ? [s.preview_hash] : []),
      ...(s.master_ready && !s.master_duration_ms ? [s.master_hash] : []),
    ]);
    for (let i = 0; i < hashes.length; i += 4) await Promise.allSettled(hashes.slice(i, i + 4).map(load));
  },

  async playOne(hash: string) {
    const buf = await load(hash);
    try {
      oneShot?.stop();
    } catch {
      // already stopped
    }
    const c = context();
    oneShot = c.createBufferSource();
    oneShot.buffer = buf;
    oneShot.connect(c.destination);
    oneShot.start();
  },

  async playTimeline(
    timeline: Timeline,
    fromMs: number,
    monitor: Tier,
    onTick: (ms: number) => void,
    onEnd: () => void,
  ) {
    stopSources();
    const mine = ++token;
    const c = context();
    const audible = audibleTracks(timeline.tracks);
    const gains = new Map(timeline.tracks.map((t) => [t.id, t.gain]));
    const endMs = Math.max(0, ...timeline.segments.map((s) => s.start_ms + segmentDuration(s, monitor)));
    const items = timeline.segments
      .filter((s) => audible.has(s.track_id) && s.start_ms + segmentDuration(s, monitor) > fromMs)
      .map((s) => ({ s, hash: hashFor(s, monitor) }))
      .filter((x): x is { s: Segment; hash: string } => x.hash !== null);

    if (!timeline.segments.some((s) => hashFor(s, monitor)))
      useStore.getState().toast("Nothing rendered yet — preview a segment first (Ctrl+Enter).", "info");

    const loaded = await Promise.all(items.map(async (x) => ({ ...x, buf: await load(x.hash) })));
    if (mine !== token) return; // stopped while loading

    const t0 = c.currentTime + 0.06;
    for (const { s, buf } of loaded) {
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = gains.get(s.track_id) ?? 1;
      src.connect(g).connect(c.destination);
      const offset = (s.start_ms - fromMs) / 1000;
      if (offset >= 0) src.start(t0 + offset);
      else if (-offset < buf.duration) src.start(t0, -offset);
      else continue;
      active.push(src);
    }

    const tick = () => {
      if (mine !== token) return;
      const ms = fromMs + Math.max(0, c.currentTime - t0) * 1000;
      onTick(ms);
      if (ms >= endMs + 250) {
        stopSources();
        onEnd();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  },

  stop() {
    token++;
    stopSources();
  },

  /** Bounce every audible segment's master render, at its timeline position, to a WAV file. */
  async mixdown(timeline: Timeline): Promise<Blob> {
    const SR = 48000;
    const audible = audibleTracks(timeline.tracks);
    const gains = new Map(timeline.tracks.map((t) => [t.id, t.gain]));
    const items = timeline.segments.filter((s) => audible.has(s.track_id) && s.master_ready);
    const loaded = await Promise.all(items.map(async (s) => ({ s, buf: await load(s.master_hash) })));
    const lengthSec = Math.max(0.5, ...loaded.map(({ s, buf }) => s.start_ms / 1000 + buf.duration)) + 0.5;
    const off = new OfflineAudioContext(2, Math.ceil(lengthSec * SR), SR);
    for (const { s, buf } of loaded) {
      const src = off.createBufferSource();
      src.buffer = buf;
      const g = off.createGain();
      g.gain.value = gains.get(s.track_id) ?? 1;
      src.connect(g).connect(off.destination);
      src.start(s.start_ms / 1000);
    }
    return encodeWav(await off.startRendering());
  },
};

function encodeWav(buf: AudioBuffer): Blob {
  const channels = buf.numberOfChannels;
  const frames = buf.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([view], { type: "audio/wav" });
}
