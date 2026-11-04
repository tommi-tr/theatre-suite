/** mm:ss (or h:mm:ss) with optional tenths. Negative values get a leading minus sign (U+2212). */
export function formatTime(sec: number | null | undefined, tenths = false): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "--:--";
  const neg = sec < 0;
  let s = Math.abs(sec);
  if (!tenths) s = Math.floor(s + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ss = tenths ? r.toFixed(1).padStart(4, "0") : String(Math.floor(r)).padStart(2, "0");
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
  return neg ? `−${body}` : body;
}

export function formatDb(db: number): string {
  if (db <= -60) return "−∞ dB";
  const v = Math.abs(db) < 0.05 ? 0 : db;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let id: ReturnType<typeof setTimeout> | null = null;
  const run = (...args: A) => {
    if (id) clearTimeout(id);
    id = setTimeout(() => {
      id = null;
      fn(...args);
    }, ms);
  };
  run.flush = (...args: A) => {
    if (id) clearTimeout(id);
    id = null;
    fn(...args);
  };
  return run;
}
