/**
 * Demo data shown when the interface runs in a normal browser (outside Diaframma),
 * used only to preview the layout during development: `pnpm dev` then open
 * http://localhost:1420/?demo
 */
import { newTrack } from "../state/types";
import { useDoc } from "../state/doc";

function peaks(seed: number, shape: (p: number) => number): number[] {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const out: number[] = [];
  let prev = 0.3;
  for (let i = 0; i < 1000; i++) {
    const p = i / 999;
    let v = shape(p) * (0.35 + 0.65 * rnd());
    v = 0.62 * v + 0.38 * prev;
    prev = v;
    out.push(Math.max(0.04, Math.min(0.96, v)));
  }
  return out;
}

export function loadDemo() {
  const mk = (id: string, name: string, dur: number, extra: Partial<ReturnType<typeof newTrack>> = {}) => ({
    ...newTrack(id),
    file: { path: `C:\\Show\\${name}`, name, relativePath: name, durationSec: dur },
    ...extra,
  });
  const tracks = [
    mk("t1", "Valzer atto II.mp3", 195, { atEnd: "fadeOut" }),
    mk("h1", "Applausi registrati.wav", 42, { hidden: true }),
    mk("t2", "Temporale lontano.wav", 208, {
      onSpace: "crossfade",
      atEnd: "loopCut",
      inSec: 4.2,
      outSec: 194,
      volumeDb: -3,
      eq: { low: 2, mid: -1.5, high: 1 },
      loop: { inSec: 80, outSec: 169.5 },
      envelope: [
        { t: 4.2, v: 0 },
        { t: 14, v: 0.85 },
        { t: 120, v: 0.7 },
        { t: 180, v: 0.95 },
      ],
    }),
    { ...newTrack("e1") },
    mk("t4", "Campane finale.flac", 66, { onSpace: "stopAllPlay" }),
  ];
  const env = {
    waltz: (p: number) => (0.38 + 0.52 * Math.pow(Math.sin(Math.PI * Math.min(1, p * 1.04)), 0.5)) * (0.8 + 0.2 * Math.sin(p * 46)),
    storm: (p: number) => {
      let s = 0.2 + 0.1 * Math.sin(p * 11);
      [0.17, 0.43, 0.62, 0.86].forEach((c, k) => (s += (0.78 - k * 0.08) * Math.exp(-Math.pow((p - c) / 0.035, 2))));
      return Math.min(1, s);
    },
    bells: (p: number) => {
      const q = (p * 4) % 1;
      return 0.14 + 0.84 * Math.exp(-q * 4.5) * (1 - p * 0.45);
    },
  };
  const info = (dur: number, pk: number[]) => ({ durationSec: dur, sampleRate: 48000, channels: 2, peaks: pk });
  useDoc.setState({
    tracks,
    filePath: "C:\\Show\\Il giardino dei ciliegi.diaframma",
    dirty: false,
    expanded: { t2: true },
    infos: {
      "C:\\Show\\Valzer atto II.mp3": info(195, peaks(11, env.waltz)),
      "C:\\Show\\Applausi registrati.wav": info(42, peaks(5, env.bells)),
      "C:\\Show\\Temporale lontano.wav": info(208, peaks(29, env.storm)),
      "C:\\Show\\Campane finale.flac": info(66, peaks(7, env.bells)),
    },
    live: {
      standbyId: "t2",
      voices: [{ trackId: "t1", positionSec: 72, durationSec: 195, paused: false, fading: null, looping: false }],
      engine: { ready: true, device: "USB Audio Interface", sampleRate: 48000, error: null },
    },
  });
}
