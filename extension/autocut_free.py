#!/usr/bin/env python3
"""
AutoCut Free (uso pessoal) - by usagi
Gera uma timeline XML (FCP7/xmeml) pra importar no Premiere Pro ou DaVinci Resolve.

Funcoes:
  silence    -> corta silencios
  highlights -> pega momentos de pico de audio (gameplay)
  --zoom     -> alterna escala 100%/112% entre cortes (zoom automatico)
  --captions -> gera .srt com Whisper local (faster-whisper), ja sincronizado com os cortes

Requisitos:
  - FFmpeg e ffprobe no PATH
  - (nenhum pacote obrigatorio)
  - (opcional, legendas) pip install faster-whisper

Exemplos:
  python autocut_free.py video.mp4 --mode silence --zoom --captions
  python autocut_free.py gameplay.mp4 --mode highlights --top 12
Importar: Premiere -> File > Import  |  Resolve -> File > Import > Timeline
"""
import argparse, json, os, re, subprocess, sys
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
from pathlib import Path
from xml.sax.saxutils import escape


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")


def probe(path):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height,r_frame_rate",
             "-show_entries", "format=duration", "-of", "json", str(path)])
    j = json.loads(r.stdout)
    s = j["streams"][0]
    n, d = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(n) / float(d), float(j["format"]["duration"])


# ---------- deteccao ----------
def measure_volume(path, track):
    """Retorna (mean_db, max_db) da faixa de audio, ou (None, None) se nao ha audio."""
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", f"0:a:{track}",
             "-af", "volumedetect", "-vn", "-f", "null", "-"])
    m = re.search(r"mean_volume: (-?[\d.]+) dB", r.stderr)
    x = re.search(r"max_volume: (-?[\d.]+) dB", r.stderr)
    if not m:
        return None, None
    return float(m.group(1)), float(x.group(1)) if x else None


def detect_silence(path, noise_db, min_sil, pad, total, track=0):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", f"0:a:{track}",
             "-af", f"silencedetect=noise={noise_db}dB:d={min_sil}", "-vn", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    starts = [max(0.0, x) for x in starts]
    sil = list(zip(starts, ends + [total] * (len(starts) - len(ends))))
    keep, cur = [], 0.0
    for s, e in sil:
        if s - cur > 0.15:
            keep.append((max(0, cur - pad), min(total, s + pad)))
        cur = e
    if total - cur > 0.15:
        keep.append((max(0, cur - pad), total))
    return merge(keep)


def detect_highlights(path, total, top, before, after, track=0):
    # mede o volume (RMS) a cada 0.5s usando so o FFmpeg (sem numpy)
    sr = 8000
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", f"0:a:{track}", "-vn",
             "-af", f"aresample={sr},asetnsamples=n={sr // 2}:p=0,astats=metadata=1:reset=1,"
                    "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
             "-f", "null", "-"])
    vals = re.findall(r"lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)", r.stdout)
    rms = []
    for v in vals:
        try:
            x = float(v)
        except ValueError:
            x = -120.0
        rms.append(-120.0 if x != x or x == float("-inf") else x)
    if not rms:
        return [(0, total)]
    order = sorted(range(len(rms)), key=lambda i: rms[i], reverse=True)
    picked = []
    for i in order:
        t = i * 0.5
        if all(abs(t - q) > (before + after) for q in picked):
            picked.append(t)
        if len(picked) >= top:
            break
    segs = [(max(0, t - before), min(total, t + after)) for t in sorted(picked)]
    return merge(segs)


def merge(segs, gap=0.05):
    out = []
    for s, e in sorted(segs):
        if out and s <= out[-1][1] + gap:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


# ---------- legendas ----------
def srt_time(t):
    h, m = int(t // 3600), int(t % 3600 // 60)
    s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"


def make_srt(path, segs, out, model_size, lang, track=0, device="cpu"):
    """Transcreve so os trechos mantidos, usando o audio extraido pelo FFmpeg (sem depender do pacote av)."""
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError:
        print("! faster-whisper nao instalado neste Python (legendas puladas). Rode o install.bat de novo.")
        return
    sr = 16000
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", f"0:a:{track}", "-vn",
                        "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True)
    audio = np.frombuffer(p.stdout, dtype=np.float32)
    if audio.size == 0:
        print("! Nao consegui extrair o audio para as legendas.")
        return
    print(f"Legendas: carregando modelo '{model_size}' (a 1a vez baixa o modelo)...")
    def load(dev):
        return WhisperModel(model_size, device=dev, compute_type="int8" if dev == "cpu" else "float16")

    def transcribe_chunk(m, chunk):
        tr, _ = m.transcribe(chunk, language=lang, vad_filter=True)
        return [(sg.start, sg.end, sg.text.strip()) for sg in tr]  # consome aqui (execucao e preguicosa)

    model = load(device)
    lines, idx, acc = [], 1, 0.0
    for n, (s, e) in enumerate(segs, 1):
        chunk = audio[int(s * sr):int(e * sr)]
        if chunk.size > sr // 5:
            try:
                res = transcribe_chunk(model, chunk)
            except RuntimeError as err:
                if device == "cpu":
                    raise
                print(f"! GPU falhou ({err}); usando CPU.")
                device = "cpu"
                model = load("cpu")
                res = transcribe_chunk(model, chunk)
            for st, en, text in res:
                if text:
                    lines.append(f"{idx}\n{srt_time(acc + st)} --> {srt_time(acc + en)}\n{text}\n")
                    idx += 1
        acc += e - s
        print(f"Legendas: trecho {n}/{len(segs)}", flush=True)
    if not lines:
        Path(out).unlink(missing_ok=True)
        print("! Nenhuma fala detectada nos trechos mantidos: .srt nao foi criado. "
              "Dica: use a faixa do microfone (--track 1) em vez da mistura com o jogo.")
        return
    with open(out, "w", encoding="utf-8", newline="") as fh:
        fh.write("\r\n".join(l.replace("\n", "\r\n").rstrip("\r\n") + "\r\n" for l in lines))
    print(f"Legendas: {idx - 1} falas -> {out}")


# ---------- xmeml ----------
def scale_filter(v):
    return (f"<filter><effect><name>Basic Motion</name><effectid>basic</effectid>"
            f"<effectcategory>motion</effectcategory><effecttype>motion</effecttype>"
            f"<mediatype>video</mediatype><parameter><parameterid>scale</parameterid>"
            f"<name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax>"
            f"<value>{v}</value></parameter></effect></filter>")


def audio_layout(path):
    """Canais de cada faixa de audio do arquivo, ex: [2, 2, 2]."""
    r = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=channels",
             "-of", "json", str(path)])
    try:
        chans = [int(x.get("channels", 2)) for x in json.loads(r.stdout).get("streams", [])]
    except Exception:
        chans = []
    return chans or [2]


def build_xml(path, segs, w, h, fps, total, zoom, name, chans):
    tb = round(fps)
    ntsc = "TRUE" if abs(fps - tb) > 0.01 else "FALSE"
    rate = f"<rate><timebase>{tb}</timebase><ntsc>{ntsc}</ntsc></rate>"
    f = lambda t: int(round(t * fps))
    url = Path(path).resolve().as_uri()
    fname = escape(Path(path).name)
    audio_blocks = "".join(
        f"<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate>"
        f"</samplecharacteristics><channelcount>{c}</channelcount></audio>" for c in chans)
    file_full = (f'<file id="file-1"><name>{fname}</name><pathurl>{url}</pathurl>{rate}'
                 f'<duration>{f(total)}</duration><media><video><samplecharacteristics>'
                 f'<width>{w}</width><height>{h}</height></samplecharacteristics></video>'
                 f'{audio_blocks}</media></file>')

    items, pos = [], 0
    for (s, e) in segs:
        d = f(e) - f(s)
        if d <= 0:
            continue
        items.append((f(s), d, pos))
        pos += d

    def common(src, d, start):
        return (f"<duration>{f(total)}</duration>{rate}<start>{start}</start><end>{start + d}</end>"
                f"<in>{src}</in><out>{src + d}</out>")

    vids = []
    for i, (src, d, start) in enumerate(items):
        fl = file_full if i == 0 else '<file id="file-1"/>'
        flv = scale_filter(112) if (zoom and i % 2 == 1) else ""
        vids.append(f'<clipitem id="v{i}"><name>{fname}</name>{common(src, d, start)}{fl}{flv}</clipitem>')

    atracks, ch = [], 0
    for c in chans:
        for k in range(c):
            ch += 1
            clips = "".join(
                f'<clipitem id="a{ch}_{i}"><name>{fname}</name>{common(src, d, start)}<file id="file-1"/>'
                f'<sourcetrack><mediatype>audio</mediatype><trackindex>{ch}</trackindex></sourcetrack></clipitem>'
                for i, (src, d, start) in enumerate(items))
            if c == 2:
                attrs = f' currentExplodedTrackIndex="{k}" totalExplodedTrackCount="2" premiereTrackType="Stereo"'
            else:
                attrs = ' premiereTrackType="Mono"'
            atracks.append(f"<track{attrs}>{clips}</track>")

    return (f'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE xmeml><xmeml version="4"><sequence>'
            f'<name>{escape(name)}</name><duration>{pos}</duration>{rate}<media><video><format>'
            f'<samplecharacteristics>{rate}<width>{w}</width><height>{h}</height></samplecharacteristics></format>'
            f'<track>{"".join(vids)}</track></video><audio>{"".join(atracks)}</audio></media>'
            f'</sequence></xmeml>')


def main():
    ap = argparse.ArgumentParser(description="AutoCut Free")
    ap.add_argument("video")
    ap.add_argument("--mode", choices=["silence", "highlights"], default="silence")
    ap.add_argument("--noise", default="auto", help="limiar de silencio em dB, ou auto")
    ap.add_argument("--track", type=int, default=0, help="faixa de audio (0 = primeira)")
    ap.add_argument("--min-silence", type=float, default=0.4)
    ap.add_argument("--pad", type=float, default=0.08, help="folga em segundos em cada corte")
    ap.add_argument("--top", type=int, default=10, help="qtd de highlights")
    ap.add_argument("--before", type=float, default=6)
    ap.add_argument("--after", type=float, default=4)
    ap.add_argument("--zoom", action="store_true")
    ap.add_argument("--captions", action="store_true")
    ap.add_argument("--model", default="small")
    ap.add_argument("--lang", default="pt")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="cpu (padrao) ou cuda (GPU NVIDIA)")
    a = ap.parse_args()

    v = Path(a.video)
    if not v.exists():
        sys.exit("Arquivo nao encontrado")
    w, h, fps, total = probe(v)
    mean_db, max_db = measure_volume(v, a.track)
    if mean_db is None:
        sys.exit(f"ERRO: nao achei a faixa de audio {a.track} neste video.")
    print(f"Audio faixa {a.track}: media {mean_db:.1f} dB, pico {max_db} dB")
    if max_db is not None and max_db < -60:
        sys.exit("ERRO: essa faixa de audio esta praticamente muda. Tente outra faixa (--track 1, 2...).")

    if a.mode == "silence":
        noise = (min(-25.0, max(-60.0, mean_db - 12)) if str(a.noise).lower() == "auto"
                 else float(a.noise))
        print(f"Limiar de silencio: {noise:.0f} dB")
        segs = detect_silence(v, noise, a.min_silence, a.pad, total, a.track)
    else:
        segs = detect_highlights(v, total, a.top, a.before, a.after, a.track)
    if not segs:
        sys.exit("ERRO: 0 cortes. Tente outra faixa de audio (--track) ou um limiar menor (ex: --noise -50).")
    chans = audio_layout(v)
    print(f"Faixas de audio no arquivo: {len(chans)} ({chans})")
    kept = sum(e - s for s, e in segs)
    print(f"{len(segs)} cortes | {total:.0f}s -> {kept:.0f}s")

    out = v.with_name(v.stem + "_autocut.xml")
    out.write_text(build_xml(v, segs, w, h, fps, total, a.zoom, v.stem + "_autocut", chans), encoding="utf-8")
    print("Timeline:", out)
    if a.captions:
        make_srt(v, segs, v.with_name(v.stem + "_autocut.srt"), a.model, a.lang, a.track, a.device)


if __name__ == "__main__":
    main()
