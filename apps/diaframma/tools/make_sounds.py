"""
Builds the standard launchpad sounds that come with Diaframma.

Every sound is synthesised here from scratch (no recordings, no licences to
worry about). Run it again to rebuild them:

    python3 apps/diaframma/tools/make_sounds.py

Needs Python 3 with numpy and scipy, and ffmpeg (for Ogg Vorbis).
The files go to apps/diaframma/src-tauri/sounds/ and are bundled with the app.
"""

import os
import subprocess
import tempfile
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "sounds")
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def env_ad(n, attack, decay):
    """Fast attack, exponential decay (seconds)."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / max(decay, 1e-4))


def bandpass(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x, f, order=2):
    sos = signal.butter(order, f, btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def highpass(x, f, order=2):
    sos = signal.butter(order, f, btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def place(dst, src, at):
    i = int(at * SR)
    j = min(len(dst), i + len(src))
    if j > i:
        dst[i:j] += src[: j - i]


def bell(f0, partials, sec, decay):
    """Additive bell: list of (ratio, amp, decay factor)."""
    t = t_axis(sec)
    y = np.zeros_like(t)
    for ratio, amp, dk in partials:
        ph = rng.uniform(0, 2 * np.pi)
        y += amp * np.sin(2 * np.pi * f0 * ratio * t + ph) * np.exp(-t / (decay * dk))
    y *= np.clip(t / 0.002, 0, 1)
    return y


def normalize(y, peak_db=-1.0):
    peak = np.max(np.abs(y)) or 1.0
    return y / peak * 10 ** (peak_db / 20)


def fade_edges(y, fin=0.005, fout=0.05):
    n_in, n_out = int(fin * SR), int(fout * SR)
    y = y.copy()
    if y.ndim == 1:
        y[:n_in] *= np.linspace(0, 1, n_in)
        y[-n_out:] *= np.linspace(1, 0, n_out)
    else:
        y[:n_in] *= np.linspace(0, 1, n_in)[:, None]
        y[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
    return y


def make_loopable(y, xf=1.0):
    """Crossfades the tail into the head so the file loops without a seam."""
    n = int(xf * SR)
    head, body, tail = y[:n], y[n:-n] if n else y, y[-n:]
    w = np.linspace(0, 1, n)
    if y.ndim == 2:
        w = w[:, None]
    mixed = tail * np.cos(w * np.pi / 2) + head * np.sin(w * np.pi / 2)
    return np.concatenate([mixed, body]) if n else y


def write(name, y, quality=5):
    y = np.asarray(y, dtype=np.float64)
    if y.ndim == 1:
        y = y[:, None]
    data = (np.clip(y, -1, 1) * 32767).astype("<i2")
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        wav_path = os.path.join(td, "x.wav")
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(data.shape[1])
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(data.tobytes())
        dst = os.path.join(OUT, name + ".ogg")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-c:a", "libvorbis", "-q:a", str(quality), "-map_metadata", "-1", dst],
            check=True,
        )
    print(f"{name}.ogg  {len(y) / SR:5.1f} s  {os.path.getsize(dst) // 1024} KB")


# ---------------------------------------------------------------- sounds


def thunder():
    sec = 8.0
    n = int(sec * SR)
    out = np.zeros((n, 2))
    for ch in range(2):
        brown = np.cumsum(rng.standard_normal(n))
        brown = highpass(brown, 20)
        rumble = lowpass(brown, 140, 4)
        # Rolling: a few slow swells after the strike.
        t = np.arange(n) / SR
        swell = np.zeros(n)
        for at, amp, dur in [(0.05, 1.0, 1.6), (0.9, 0.7, 2.0), (2.2, 0.55, 2.5), (3.8, 0.35, 3.0)]:
            k = np.clip((t - at) / 0.25, 0, 1) * np.exp(-np.clip(t - at, 0, None) / dur)
            swell += amp * k
        rumble = rumble / np.max(np.abs(rumble)) * swell
        # The crack: bright noise bursts at the start.
        crack = np.zeros(n)
        for at in [0.0, 0.04, 0.11, 0.19, 0.33]:
            b = highpass(rng.standard_normal(int(0.4 * SR)), 900) * env_ad(int(0.4 * SR), 0.002, 0.07 + rng.uniform(0, 0.06))
            place(crack, b * rng.uniform(0.5, 1.0), at + rng.uniform(0, 0.01))
        mid = bandpass(rng.standard_normal(n), 120, 900) * np.exp(-t / 1.2) * 0.5
        out[:, ch] = rumble * 1.0 + crack * 0.45 + mid * 0.4
    return fade_edges(normalize(out, -1.0), 0.002, 0.8)


def rain():
    sec = 12.0
    n = int(sec * SR)
    out = np.zeros((n, 2))
    for ch in range(2):
        bed = bandpass(rng.standard_normal(n), 400, 9000) * 0.25
        bed = lowpass(bed, 6000)
        drops = np.zeros(n)
        k = int(0.012 * SR)
        for _ in range(int(sec * 260)):
            f = rng.uniform(1500, 6000)
            d = np.sin(2 * np.pi * f * np.arange(k) / SR) * env_ad(k, 0.0005, 0.002) * rng.uniform(0.05, 0.4)
            place(drops, d, rng.uniform(0, sec - 0.02))
        out[:, ch] = bed + drops
    return normalize(make_loopable(out, 1.0), -4.0)


def wind():
    sec = 12.0
    n = int(sec * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ch in range(2):
        x = rng.standard_normal(n)
        y = np.zeros(n)
        # Moving resonance: process in short blocks with a sweeping band.
        blk = 2048
        centre = 500 + 300 * np.sin(2 * np.pi * t / 5.3 + ch) + 150 * np.sin(2 * np.pi * t / 2.1)
        zi = None
        for i in range(0, n, blk):
            c = centre[i]
            sos = signal.butter(2, [c * 0.7, c * 1.4], btype="band", fs=SR, output="sos")
            if zi is None:
                zi = np.zeros((sos.shape[0], 2))
            y[i : i + blk], zi = signal.sosfilt(sos, x[i : i + blk], zi=zi)
        gust = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * t / 4.7 + ch * 0.8)) ** 2
        out[:, ch] = y * gust + lowpass(x, 250) * 0.15
    return normalize(make_loopable(out, 1.5), -4.0)


def doorbell():
    partials = [(1.0, 1.0, 1.0), (2.0, 0.35, 0.6), (2.76, 0.18, 0.45), (5.4, 0.06, 0.25)]
    out = np.zeros(int(3.4 * SR))
    place(out, bell(659.25, partials, 2.2, 0.9), 0.0)  # E5 "ding"
    place(out, bell(523.25, partials, 2.6, 1.1), 0.55)  # C5 "dong"
    return fade_edges(normalize(out, -2.0), 0.001, 0.3)


def phone_bell():
    """Old telephone: two small bells hit by a hammer about 20 times per second."""
    out = np.zeros(int(8.0 * SR))
    partials = [(1.0, 1.0, 1.0), (2.1, 0.4, 0.5), (3.2, 0.2, 0.4)]
    for ring_at in (0.0, 4.0):
        hits = int(1.8 * 20)
        for h in range(hits):
            f0 = 1046 if h % 2 == 0 else 1175
            b = bell(f0, partials, 0.25, 0.06) * rng.uniform(0.75, 1.0)
            place(out, b, ring_at + h / 20)
    return fade_edges(normalize(out, -2.0), 0.001, 0.2)


def phone_modern():
    """Electronic ring: two tones alternating 16 times per second."""
    out = np.zeros(int(9.0 * SR))
    for ring_at in (0.0, 3.0, 6.0):
        t = t_axis(1.2)
        sel = (np.floor(t * 16) % 2).astype(bool)
        f = np.where(sel, 1300.0, 1000.0)
        ph = 2 * np.pi * np.cumsum(f) / SR
        tone = np.sin(ph) + 0.25 * np.sin(3 * ph)
        tone *= np.clip(t / 0.01, 0, 1) * np.clip((1.2 - t) / 0.02, 0, 1)
        place(out, tone, ring_at)
    return normalize(lowpass(out, 6000), -3.0)


def knock():
    out = np.zeros(int(2.6 * SR))
    times = [0.0, 0.22, 0.44, 1.3, 1.52]
    for at in times:
        k = int(0.18 * SR)
        tt = np.arange(k) / SR
        body = np.sin(2 * np.pi * rng.uniform(150, 190) * tt) * np.exp(-tt / 0.03)
        body += 0.6 * np.sin(2 * np.pi * rng.uniform(330, 400) * tt) * np.exp(-tt / 0.02)
        click = bandpass(rng.standard_normal(k), 800, 4000) * np.exp(-tt / 0.004) * 0.6
        place(out, (body + click) * rng.uniform(0.85, 1.0), at)
    return fade_edges(normalize(out, -1.5), 0.001, 0.2)


def alarm_siren():
    """Wailing siren, loops seamlessly (one full cycle per 3 s)."""
    sec = 6.0
    t = t_axis(sec)
    f = 850 + 350 * np.sin(2 * np.pi * t / 3.0 - np.pi / 2)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    return normalize(lowpass(y, 5000), -3.0)


def alarm_bell():
    """Fire / school bell: a hammer hitting a gong 22 times per second; loops."""
    sec = 5.0
    out = np.zeros(int(sec * SR) + int(0.3 * SR))
    partials = [(1.0, 1.0, 1.0), (2.32, 0.6, 0.6), (3.9, 0.35, 0.4), (5.1, 0.2, 0.3)]
    for h in range(int(sec * 22)):
        place(out, bell(1480, partials, 0.3, 0.09) * rng.uniform(0.8, 1.0), h / 22)
    y = out[: int(sec * SR)]
    return normalize(y, -2.0)


def clock_tick():
    """Tick-tock, one per second; loops."""
    sec = 4.0
    out = np.zeros(int(sec * SR))
    for i in range(4):
        k = int(0.05 * SR)
        tt = np.arange(k) / SR
        f = 2600 if i % 2 == 0 else 2000
        c = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.004)
        c += bandpass(rng.standard_normal(k), 1500, 6000) * np.exp(-tt / 0.002) * 0.5
        place(out, c, i * 1.0 + 0.02)
    return normalize(out, -3.0)


def church_bell():
    partials = [(0.5, 0.6, 1.4), (1.0, 1.0, 1.0), (1.19, 0.55, 0.8), (1.5, 0.35, 0.6), (2.0, 0.5, 0.5), (2.5, 0.15, 0.35), (3.0, 0.1, 0.3)]
    out = np.zeros(int(11.0 * SR))
    for i in range(3):
        b = bell(330.0, partials, 7.0, 2.4)
        place(out, b, i * 2.6)
    return fade_edges(normalize(out, -2.0), 0.001, 1.0)


def car_horn():
    out = np.zeros(int(1.4 * SR))
    for at, dur in [(0.0, 0.28), (0.4, 0.75)]:
        t = t_axis(dur)
        y = signal.sawtooth(2 * np.pi * 415 * t) + 0.8 * signal.sawtooth(2 * np.pi * 520 * t)
        y = lowpass(y, 2500, 2)
        y *= np.clip(t / 0.01, 0, 1) * np.clip((dur - t) / 0.02, 0, 1)
        place(out, y, at)
    return normalize(out, -2.0)


def applause():
    sec = 9.0
    n = int(sec * SR)
    out = np.zeros((n, 2))
    t = np.arange(n) / SR
    # Density: swells in, holds, fades.
    density = np.interp(t, [0, 1.2, 6.5, sec], [5, 120, 110, 3])
    k = int(0.03 * SR)
    tt = np.arange(k) / SR
    count = int(np.sum(density) / SR)
    times = np.sort(rng.choice(n, size=count, p=density / density.sum())) / SR
    for at in times:
        f = rng.uniform(900, 2600)
        c = bandpass(rng.standard_normal(k), f * 0.6, min(f * 1.8, 16000)) * np.exp(-tt / rng.uniform(0.004, 0.009))
        pan = rng.uniform(0.15, 0.85)
        a = rng.uniform(0.3, 1.0)
        place(out[:, 0], c * a * (1 - pan), at)
        place(out[:, 1], c * a * pan, at)
    return fade_edges(normalize(out, -2.0), 0.05, 1.5)


def beep():
    t = t_axis(1.0)
    y = np.sin(2 * np.pi * 1000 * t)
    return fade_edges(normalize(y, -6.0), 0.005, 0.005)


SOUNDS = [
    ("thunder", thunder),
    ("doorbell", doorbell),
    ("phone-bell", phone_bell),
    ("phone-ring", phone_modern),
    ("knock", knock),
    ("alarm-siren", alarm_siren),
    ("alarm-bell", alarm_bell),
    ("car-horn", car_horn),
    ("applause", applause),
    ("rain", rain),
    ("wind", wind),
    ("clock", clock_tick),
    ("church-bell", church_bell),
    ("beep", beep),
]

if __name__ == "__main__":
    for name, fn in SOUNDS:
        write(name, fn())
