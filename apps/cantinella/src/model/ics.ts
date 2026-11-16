/** Calendar files (`.ics`, RFC 5545) for phones and computer calendars. Times are local ("floating"). */

export interface IcsEvent {
  uid: string;
  /** `YYYY-MM-DD` */
  day: string;
  /** `HH:MM`; empty = all-day event. */
  time: string;
  minutes: number;
  title: string;
  place?: string;
  description?: string;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 characters continue on the next line, starting with a space. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

const compactDay = (day: string) => day.replace(/-/g, "");

function addMinutes(day: string, time: string, minutes: number): { day: string; time: string } {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm + minutes));
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`, time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}` };
}

export function icsCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Theatre Suite//Cantinella//IT", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@cantinella.theatresuite.it`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const end = addMinutes(e.day, e.time, Math.max(1, e.minutes));
      lines.push(`DTSTART:${compactDay(e.day)}T${e.time.replace(":", "")}00`, `DTEND:${compactDay(end.day)}T${end.time.replace(":", "")}00`);
    } else {
      const next = addMinutes(e.day, "00:00", 24 * 60);
      lines.push(`DTSTART;VALUE=DATE:${compactDay(e.day)}`, `DTEND;VALUE=DATE:${compactDay(next.day)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.place) lines.push(`LOCATION:${esc(e.place)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
