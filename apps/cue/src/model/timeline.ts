import { actionDept, DEPTS, sortGos, type Action, type AnchorPos, type Dept, type Go } from "./gos";

/**
 * The timeline of the Show and Prepara screens (13_cue.md, "Schermata Show"; docs/cue/design): where the GO buttons
 * and the boxes of the columns Luci · Audio · Video go, in script pixels (the columns scroll with the script). Pure.
 *
 * - The **dot** of a GO is at `anchorToY(anchor)` on the script margin; its line goes to the button.
 * - The **button** is `BUTTON_H` (34) px high and the line enters it at half height: `buttonTop = dotY − 17`. Two GOs
 *   too close never overlap: a button is pushed down to `previous bottom + minGap`, and `offset` (> 0) says the line
 *   from the dot curves to reach it.
 * - From the button the line goes on at `lineY = buttonTop + 17` through the columns, up to the last box of the GO
 *   (`lineEnd`). The **top of every box** of a GO is the top of its button, so the line ends inside the box.
 * - A **light** or **video** box lasts until the next box of the same column (`bottom = next top − boxGap`); the
 *   last one until `endY` (the end of the script) or `LAST_BOX_H` px.
 * - An **audio** box has the height the user dragged (`audioHeights[actionId]`, default 72 px, at least 40) and never
 *   reaches into the next audio box; a stop box is 40 px. Several boxes of one GO in one column stack downwards.
 * - A column with no boxes is not in `columns` (it does not exist on screen; the others widen).
 */

export const BUTTON_H = 34;
export const MIN_GAP = 6;
export const BOX_GAP = 6;
export const AUDIO_H = 72;
export const AUDIO_MIN_H = 40;
export const STOP_H = 40;
export const LAST_BOX_H = 160;
/** Smallest box when boxes have to be squeezed. */
const SQUEEZED_H = 16;

export interface TimelineOptions {
  /** Where an anchor is on the script, in pixels from the top of the first page (the script view's function). */
  anchorToY: (a: AnchorPos) => number;
  /** Heights of the audio boxes set by the user (`show.layout.audioBoxHeights`). */
  audioHeights?: Record<string, number>;
  /** Bottom of the script: where the last light/video box ends. */
  endY?: number;
  buttonHeight?: number;
  minGap?: number;
  boxGap?: number;
  audioHeight?: number;
}

export interface TimelineBox {
  goId: string;
  actionId: string;
  kind: Action["kind"];
  column: Dept;
  top: number;
  bottom: number;
  height: number;
  /** Position in the stack of this GO in this column (0 = aligned to the button). */
  stack: number;
  /** The user can drag its bottom (audio boxes). */
  resizable: boolean;
}

export interface TimelineGo {
  goId: string;
  /** Index in script order. */
  index: number;
  /** The dot on the script margin. */
  dotY: number;
  buttonTop: number;
  /** Where the line enters the button and crosses the columns (button top + half height). */
  lineY: number;
  /** How far the button was pushed down to avoid the one above (0 = straight line). */
  offset: number;
  /** The line from the dot curves to reach the button. */
  curved: boolean;
  boxes: TimelineBox[];
  /** The rightmost column with a box of this GO (where its line ends); null = no boxes. */
  lineEnd: Dept | null;
}

export interface Timeline {
  gos: TimelineGo[];
  /** Columns that exist (have at least one box), in order. */
  columns: Dept[];
  /** Total height in script pixels. */
  height: number;
}

interface StackItem {
  action: Action;
  desired: number;
  /** Takes the rest of the room (the last light/video box). */
  fill: boolean;
}

/** Lays out a stack of boxes from `top` within `limit` (exclusive bottom, may be Infinity). */
function layoutStack(top: number, limit: number, items: StackItem[], gap: number, fillDefault: number): { top: number; bottom: number }[] {
  const n = items.length;
  const room = limit - top;
  const fixed = items.map((it) => (it.fill ? 0 : it.desired));
  const fills = items.filter((it) => it.fill).length;
  const used = fixed.reduce((a, b) => a + b, 0) + gap * (n - 1);
  let heights: number[];
  if (!Number.isFinite(room)) heights = items.map((it, i) => (it.fill ? fillDefault : fixed[i]));
  else if (used + fills * SQUEEZED_H <= room) {
    const fillH = fills ? (room - used) / fills : 0;
    heights = items.map((it, i) => (it.fill ? fillH : fixed[i]));
  } else {
    // Not enough room: everything shrinks in proportion (never below SQUEEZED_H).
    const want = items.map((it, i) => (it.fill ? Math.max(SQUEEZED_H, fillDefault / 4) : fixed[i]));
    const total = want.reduce((a, b) => a + b, 0);
    const avail = Math.max(0, room - gap * (n - 1));
    heights = want.map((w) => Math.max(SQUEEZED_H, (w * avail) / total));
  }
  const out: { top: number; bottom: number }[] = [];
  let y = top;
  for (const h of heights) {
    out.push({ top: y, bottom: y + h });
    y += h + gap;
  }
  return out;
}

export function layoutTimeline(gos: readonly Go[], opts: TimelineOptions): Timeline {
  const bh = opts.buttonHeight ?? BUTTON_H;
  const half = bh / 2;
  const minGap = opts.minGap ?? MIN_GAP;
  const boxGap = opts.boxGap ?? BOX_GAP;
  const audioDefault = opts.audioHeight ?? AUDIO_H;
  const heights = opts.audioHeights ?? {};
  const list = sortGos(gos);

  // Buttons: in script order, each at least minGap below the one above.
  const rows: TimelineGo[] = [];
  let prevBottom = -Infinity;
  list.forEach((g, index) => {
    const dotY = opts.anchorToY(g.anchor);
    const ideal = dotY - half;
    const buttonTop = Math.max(ideal, prevBottom + minGap);
    prevBottom = buttonTop + bh;
    const offset = buttonTop - ideal;
    rows.push({ goId: g.id, index, dotY, buttonTop, lineY: buttonTop + half, offset, curved: offset > 0.5, boxes: [], lineEnd: null });
  });

  // Boxes, column by column: the room of a GO's stack ends at the next GO's stack in the same column.
  const present: Dept[] = [];
  let maxBottom = 0;
  for (const dept of DEPTS) {
    const stacks = list
      .map((g, i) => ({ i, actions: g.actions.filter((a) => actionDept(a) === dept) }))
      .filter((s) => s.actions.length > 0);
    if (!stacks.length) continue;
    present.push(dept);
    stacks.forEach((s, k) => {
      const row = rows[s.i];
      const next = stacks[k + 1];
      const limit = next ? rows[next.i].buttonTop - boxGap : (opts.endY ?? Infinity);
      const items: StackItem[] = s.actions.map((a, j) => {
        if (a.kind === "audio") {
          const h = heights[a.id];
          return { action: a, desired: Math.max(AUDIO_MIN_H, typeof h === "number" && Number.isFinite(h) ? h : audioDefault), fill: false };
        }
        if (a.kind === "audioStop") return { action: a, desired: STOP_H, fill: false };
        // Light / video: the last of the stack lasts until the next one.
        const last = j === s.actions.length - 1;
        return { action: a, desired: last ? 0 : audioDefault, fill: last };
      });
      // A light box at the end of the script with no endY: LAST_BOX_H.
      const boxes = layoutStack(row.buttonTop, limit, items, boxGap, LAST_BOX_H);
      // Every box stays within `limit`: an audio box never reaches into the next one of its column.
      boxes.forEach((b, j) => {
        const it = items[j];
        row.boxes.push({ goId: row.goId, actionId: it.action.id, kind: it.action.kind, column: dept, top: b.top, bottom: b.bottom, height: b.bottom - b.top, stack: j, resizable: it.action.kind === "audio" });
        maxBottom = Math.max(maxBottom, b.bottom);
      });
    });
  }
  for (const row of rows) {
    row.boxes.sort((a, b) => DEPTS.indexOf(a.column) - DEPTS.indexOf(b.column) || a.stack - b.stack);
    row.lineEnd = row.boxes.length ? row.boxes[row.boxes.length - 1].column : null;
  }
  const lastButton = rows.length ? rows[rows.length - 1].buttonTop + bh : 0;
  return { gos: rows, columns: present, height: Math.max(opts.endY ?? 0, maxBottom, lastButton) };
}

/** The GO whose button is at `y` (script pixels), for clicks and drags; null if none. */
export function goAtY(t: Timeline, y: number, buttonHeight = BUTTON_H): TimelineGo | null {
  return t.gos.find((g) => y >= g.buttonTop && y <= g.buttonTop + buttonHeight) ?? null;
}

/** The new height of an audio box dragged by its handle to `bottomY` (at least AUDIO_MIN_H). */
export const draggedAudioHeight = (box: Pick<TimelineBox, "top">, bottomY: number): number => Math.max(AUDIO_MIN_H, Math.round(bottomY - box.top));
