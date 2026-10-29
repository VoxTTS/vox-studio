"""Vox Studio local inference worker.

Reads one JSON request per line on stdin and answers one JSON line on stdout:
  {"id", "op": "tts", "adapter", "path", "text", "voice", "speed", "out"}
  {"id", "op": "stt", "adapter", "path", "audio", "language", "word_timestamps"}
  {"id", "op": "unload", "path"}
Models stay loaded between requests (the two most recently used).
Library chatter goes to stderr so stdout stays a clean protocol channel.
"""

import glob
import json
import os
import sys
import traceback
import wave
from collections import OrderedDict

PROTOCOL = sys.stdout
sys.stdout = sys.stderr  # anything a library prints must not corrupt the protocol

LOADED = OrderedDict()
MAX_LOADED = 2


def write_wav(path, samples, rate):
    """Write float samples in [-1, 1] (numpy array or list) as 16-bit mono WAV."""
    import numpy as np

    data = np.asarray(samples, dtype=np.float32).reshape(-1)
    pcm = (np.clip(data, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(rate))
        wf.writeframes(pcm.tobytes())
    return len(pcm) * 1000 // int(rate)


def read_wav(path):
    """16-bit PCM WAV (the browser converts uploads to 16 kHz mono) -> float32 mono, rate."""
    import numpy as np

    with wave.open(path, "rb") as wf:
        rate, channels, width = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if width != 2:
        raise ValueError("Expected 16-bit PCM WAV")
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def to_16k(data, rate):
    """Linear resample to the 16 kHz that speech recognisers expect."""
    import numpy as np

    if rate == 16000:
        return data
    n = int(len(data) * 16000 / rate)
    return np.interp(np.linspace(0, len(data) - 1, n), np.arange(len(data)), data).astype(np.float32)


def short_path(data_dir):
    """espeak-ng keeps its data path in a 160-byte buffer and silently falls back
    to its build path when a longer one is truncated. phonemizer resolves
    symlinks, so a deep venv gets a one-time copy (~20 MB) at a short path."""
    if len(data_dir) < 120:
        return data_dir
    import shutil
    import tempfile

    short = os.path.join(tempfile.gettempdir(), "vox-studio-espeak-ng-data")
    marker = os.path.join(short, ".source")
    try:
        with open(marker, encoding="utf8") as f:
            if f.read() == data_dir:
                return short
    except OSError:
        pass
    if os.path.islink(short):
        os.remove(short)
    shutil.rmtree(short, ignore_errors=True)
    shutil.copytree(data_dir, short)
    with open(marker, "w", encoding="utf8") as f:
        f.write(data_dir)
    return short


def wav_duration_ms(path):
    with wave.open(path, "rb") as wf:
        return wf.getnframes() * 1000 // wf.getframerate()


# ---------------------------------------------------------------- adapters


class Piper:
    def __init__(self, path, repo):
        from piper import PiperVoice

        models = sorted(glob.glob(os.path.join(path, "**", "*.onnx"), recursive=True))
        if not models:
            raise FileNotFoundError("No .onnx voice in this download")
        self.onnx = models[0]
        self.voice = PiperVoice.load(self.onnx)
        with open(self.onnx + ".json", encoding="utf8") as f:
            self.speakers = json.load(f).get("speaker_id_map") or {}

    def tts(self, text, out, voice=None, speed=None):
        speaker = None
        if voice is not None:
            speaker = self.speakers.get(voice, int(voice) if str(voice).isdigit() else None)
        length_scale = 1.0 / speed if speed else None
        with wave.open(out, "wb") as wf:
            try:  # piper-tts >= 1.3
                from piper import SynthesisConfig

                cfg = SynthesisConfig(speaker_id=speaker, length_scale=length_scale)
                self.voice.synthesize_wav(text, wf, syn_config=cfg)
            except ImportError:  # piper-tts 1.2
                self.voice.synthesize(text, wf, speaker_id=speaker, length_scale=length_scale)
        return {"sample_rate": self.voice.config.sample_rate, "duration_ms": wav_duration_ms(out)}


class FasterWhisper:
    def __init__(self, path, repo):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(path, device="auto", compute_type="int8")

    def stt(self, audio, language=None, word_timestamps=False):
        # Pass samples, not the path: faster-whisper's own decoder (PyAV) breaks across versions.
        data, rate = read_wav(audio)
        segments, info = self.model.transcribe(to_16k(data, rate), language=language, word_timestamps=word_timestamps)
        text, words = [], []
        for seg in segments:
            text.append(seg.text)
            for w in seg.words or []:
                words.append({"word": w.word.strip(), "start_ms": int(w.start * 1000), "end_ms": int(w.end * 1000), "confidence": round(w.probability, 3)})
        return {"text": "".join(text).strip(), "words": words, "language": info.language, "audio_ms": int(info.duration * 1000)}


class Transformers:
    def __init__(self, path, repo, task):
        from transformers import pipeline

        self.task = task
        name = "text-to-speech" if task == "tts" else "automatic-speech-recognition"
        self.pipe = pipeline(name, model=path, device=-1)

    def tts(self, text, out, voice=None, speed=None):
        result = self.pipe(text)
        rate = result["sampling_rate"]
        return {"sample_rate": rate, "duration_ms": write_wav(out, result["audio"], rate)}

    def stt(self, audio, language=None, word_timestamps=False):
        data, rate = read_wav(audio)
        data, rate = to_16k(data, rate), 16000
        kwargs = {"chunk_length_s": 30}
        generate = {}
        if language and "whisper" in self.pipe.model.config.model_type:
            generate["language"] = language
        if generate:
            kwargs["generate_kwargs"] = generate
        words = []
        if word_timestamps:
            try:
                result = self.pipe({"raw": data, "sampling_rate": rate}, return_timestamps="word", **kwargs)
                for c in result.get("chunks", []):
                    start, end = c["timestamp"]
                    words.append({"word": c["text"].strip(), "start_ms": int((start or 0) * 1000), "end_ms": int((end or start or 0) * 1000)})
            except Exception:  # not every architecture supports word timestamps
                result = self.pipe({"raw": data, "sampling_rate": rate}, **kwargs)
        else:
            result = self.pipe({"raw": data, "sampling_rate": rate}, **kwargs)
        return {"text": result["text"].strip(), "words": words, "language": language, "audio_ms": len(data) * 1000 // rate}


class Kokoro:
    def __init__(self, path, repo):
        from kokoro import KModel

        weights = sorted(glob.glob(os.path.join(path, "*.pth")))
        if not weights:
            raise FileNotFoundError("No .pth weights in this download")
        self.path = path
        self.repo = repo
        self.model = KModel(repo_id=repo, config=os.path.join(path, "config.json"), model=weights[0]).eval()
        self.pipelines = {}

    def tts(self, text, out, voice=None, speed=None):
        import numpy as np
        from kokoro import KPipeline

        voice = voice or "af_heart"
        lang = voice[0]
        if lang not in self.pipelines:
            self.pipelines[lang] = KPipeline(lang_code=lang, repo_id=self.repo, model=self.model)
        pack = os.path.join(self.path, "voices", f"{voice}.pt")
        chunks = [audio for _, _, audio in self.pipelines[lang](text, voice=pack, speed=speed or 1.0) if audio is not None]
        audio = np.concatenate([np.asarray(c) for c in chunks]) if chunks else np.zeros(1)
        return {"sample_rate": 24000, "duration_ms": write_wav(out, audio, 24000)}


class KokoroOnnx:
    LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}

    def __init__(self, path, repo):
        import espeakng_loader
        from kokoro_onnx import EspeakConfig, Kokoro

        models = sorted(glob.glob(os.path.join(path, "**", "*.onnx"), recursive=True))
        voices = sorted(glob.glob(os.path.join(path, "**", "voices*.bin"), recursive=True))
        if not models or not voices:
            raise FileNotFoundError("Needs a .onnx model and a voices*.bin file")
        config = EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=short_path(espeakng_loader.get_data_path()))
        self.kokoro = Kokoro(models[0], voices[0], espeak_config=config)

    def tts(self, text, out, voice=None, speed=None):
        voice = voice or "af_heart"
        samples, rate = self.kokoro.create(text, voice=voice, speed=speed or 1.0, lang=self.LANGS.get(voice[0], "en-us"))
        return {"sample_rate": rate, "duration_ms": write_wav(out, samples, rate)}


def engine(adapter, path, repo, task):
    key = (adapter, path)
    if key in LOADED:
        LOADED.move_to_end(key)
        return LOADED[key]
    if adapter == "piper":
        e = Piper(path, repo)
    elif adapter == "faster-whisper":
        e = FasterWhisper(path, repo)
    elif adapter == "transformers":
        e = Transformers(path, repo, task)
    elif adapter == "kokoro":
        e = Kokoro(path, repo)
    elif adapter == "kokoro-onnx":
        e = KokoroOnnx(path, repo)
    else:
        raise ValueError(f"Unknown adapter {adapter}")
    LOADED[key] = e
    while len(LOADED) > MAX_LOADED:
        LOADED.popitem(last=False)
    return e


def handle(req):
    op = req["op"]
    if op == "tts":
        e = engine(req["adapter"], req["path"], req.get("repo"), "tts")
        return e.tts(req["text"], req["out"], voice=req.get("voice"), speed=req.get("speed"))
    if op == "stt":
        e = engine(req["adapter"], req["path"], req.get("repo"), "stt")
        return e.stt(req["audio"], language=req.get("language"), word_timestamps=req.get("word_timestamps", False))
    if op == "unload":
        for key in [k for k in LOADED if k[1] == req["path"]]:
            del LOADED[key]
        return {}
    if op == "ping":
        return {"pong": True}
    raise ValueError(f"Unknown op {op}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            reply = {"id": req.get("id"), "ok": True, "result": handle(req)}
        except Exception as exc:  # report every failure to the caller, keep serving
            traceback.print_exc(file=sys.stderr)
            reply = {"id": req.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        PROTOCOL.write(json.dumps(reply) + "\n")
        PROTOCOL.flush()


if __name__ == "__main__":
    main()
