import type { CSSProperties } from "react";

/**
 * Line icons shared by the whole suite: 24×24 grid, 2 px stroke,
 * round caps. Names ending in "F" are filled glyphs.
 */
export const ICONS = {
  playF: "M7 4.5v15a1 1 0 0 0 1.5.86l12.3-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z",
  pauseF: "M6 4h4v16H6zM14 4h4v16h-4z",
  stopF: "M6 6h12v12H6z",
  nextF: "M5 5v14l10-7zM17 5h2v14h-2z",
  prevF: "M19 5v14L9 12zM5 5h2v14H5z",
  starF: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  fadeIn: "M3 19c7 0 9-14 18-14",
  fadeOut: "M3 5c9 0 11 14 18 14",
  crossfade: "M3 6c7 0 11 12 18 12M3 18c7 0 11-12 18-12",
  stopPlay: "M3 7h6v10H3zM13 6l8 6-8 6z",
  repeat: "M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3",
  loopCut:
    "M6 4H3v16h3M18 4h3v16h-3M15 9h-5a2 2 0 0 0-2 2v1M13 7l2 2-2 2M9 15h5a2 2 0 0 0 2-2v-1M11 17l-2-2 2-2",
  fileAdd: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  eraser:
    "M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9",
  trash:
    "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
  eyeOff:
    "M9.9 9.9a3 3 0 1 0 4.2 4.2M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  chevDown: "M6 9l6 6 6-6",
  chevUp: "M18 15l-6-6-6 6",
  chevRight: "M9 18l6-6-6-6",
  chevLeft: "M15 18l-6-6 6-6",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
  unlock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 9.9-1",
  reorder: "M21 16l-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16",
  folderOpen:
    "M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2",
  plus: "M5 12h14M12 5v14",
  flag: "M5 22V3M5 4h13l-2.5 4.5L18 13H5",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  book: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  settings:
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  headphones:
    "M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",
  speaker:
    "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 6h.01M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  volume: "M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14",
  gauge: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  reset: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  zoom: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35M11 8v6M8 11h6",
  edges: "M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3",
  stopAll: "M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86zM9 9h6v6H9z",
  curtain: "M2 3h20M4 3v18M20 3v18M4 3c0 7 3 11 7 12M20 3c0 7-3 11-7 12M2 21h20",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  minus: "M5 12h14",
  square: "M6 6h12v12H6z",
  restore: "M8 8h12v12H8zM4 16V4h12",
  ignoreVol: "M3 17l5-6 4 3 4-6 5 5M3 3l18 18",
  music:
    "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01",
  message: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  window: "M3 4h18v16H3zM3 9h18",
  wifi: "M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  monitor: "M2 3h20v14H2zM8 21h8M12 17v4",
  collapse: "M7 3l5 5 5-5M7 21l5-5 5 5M4 12h16",
  expand: "M7 8l5-5 5 5M7 16l5 5 5-5M4 12h16",
  compact: "M4 5h16M4 9.5h16M4 14h16M4 18.5h16",
  duplicate: "M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  keyboard: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  pin: "M12 17v5M8 3h8l-1.5 7L18 13H6l3.5-3z",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  hdmi: "M3 7h18v7l-3 3H6l-3-3zM7 11h10",
  pencil: "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  hand: "M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0",
  toEnd: "M5 12h12M13 7l5 5-5 5M21 5v14",
  toggle: "M7 7h10a5 5 0 0 1 0 10H7A5 5 0 0 1 7 7zM7 12h.01",
  archive: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4",
  mask: "M5 5h14v6a7 7 0 0 1-14 0zM9 10h.01M15 10h.01M9.5 14c1.5 1.5 3.5 1.5 5 0",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 21",
  arrowLeft: "M19 12H5M12 19l-7-7 7-7",
  // Writing (Bardo)
  speech: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM7 8h10M7 12h6",
  italic: "M19 4h-9M14 20H5M15 4L9 20",
  parens: "M8 3c-4 5-4 13 0 18M16 3c4 5 4 13 0 18",
  door: "M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M14 12h.01",
  frame: "M3 5h18v14H3zM7 9h10v6H7z",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0",
  users: "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 21a7 7 0 0 1 14 0M16 3.13a4 4 0 0 1 0 7.75M22 21a7 7 0 0 0-4-6.3",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  set: "M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6",
  shirt: "M20.4 3.5L16 2a4 4 0 0 1-8 0L3.6 3.5a2 2 0 0 0-1.3 2.2l.6 3.5a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.5a2 2 0 0 0-1.3-2.2z",
  bulb: "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z",
  tags: "M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.59-8.59a1 1 0 0 0 0-1.41zM7 7h.01",
  version: "M3 7h3l3-4h6l3 4h3v13H3zM12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  listNum: "M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M6 19H4c0-1.5 2-2 2-3.5a1 1 0 0 0-2 0",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
  omega: "M3 20h5v-1.5a7 7 0 1 1 8 0V20h5",
  note: "M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5zM15 3v6h6",
  footnote: "M3 5h12M3 10h12M3 15h8M3 20h18M19 3v6",
  suggest: "M11 4H4v16h16v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z",
  spell: "M3 16l4-10 4 10M4.5 12.5h5M14 15l3 3 5-7",
  chart: "M3 3v18h18M7 16v-4M12 16V8M17 16v-7",
  focus: "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M8 12h8",
  case: "M3 17l4-10 4 10M4.5 13h5M17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 11v6",
  brush: "M18.4 2.6a2.17 2.17 0 0 1 3 3L16 11l-3-3zM13 8l-7.5 7.5a3 3 0 0 0 4 4L17 12",
  sizeUp: "M3 18l5-12 5 12M5 14h6M18 8v6M15 11h6",
  sizeDown: "M3 18l5-12 5 12M5 14h6M15 11h6",
  bold: "M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z",
  underline: "M6 3v7a6 6 0 0 0 12 0V3M4 21h16",
  fontColor: "M4 21h16M7 17l5-13 5 13M9 12h6",
  highlighter: "M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  alignL: "M21 6H3M15 12H3M17 18H3",
  alignC: "M21 6H3M17 12H7M19 18H5",
  alignR: "M21 6H3M21 12H9M21 18H7",
  justify: "M21 6H3M21 12H3M21 18H3",
  outdent: "M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4",
  indent: "M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4",
  lineH: "M3 7l3-3 3 3M6 4v16M3 17l3 3 3-3M13 6h8M13 12h8M13 18h8",
  pilcrow: "M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13",
  pageBreak: "M4 4v4h16V4M4 20v-4h16v4M3 12h2M8 12h2M14 12h2M19 12h2",
  tree: "M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3",
  pages: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  scroll: "M4 4h16M4 9h16M4 14h16M4 19h10",
  marks: "M4 18h16M7 14l5-11 5 11M9.5 9h5M4 22h2M9 22h2M14 22h2M19 22h1",
  sync: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  crew: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  title: "M4 4h16M4 9h10M4 15h16M4 20h10",
  pen: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  type: "M4 7V4h16v3M9 20h6M12 4v16",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  clipboard: "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
  scissors: "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  share: "M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98",
  folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  stamp: "M5 22h14M19 15H5a2 2 0 0 0-2 2v3h18v-3a2 2 0 0 0-2-2zM9 15v-3a3 3 0 1 1 6 0v3",
  upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
  braces: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
  margins: "M3 3h18v18H3zM7 7h10v10H7z",
  header: "M3 3h18v18H3zM3 8h18M3 16h18",
  sparkle: "M12 3l1.9 5.8L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.2z",
  video: "M2 6h14v12H2zM16 10l6-4v12l-6-4",
  layers: "M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5",
  // Production (Cantinella)
  euro: "M18 7a6 6 0 1 0 0 10M4 10h9M4 14h9",
  trafficLight: "M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7h.01M12 12h.01M12 17h.01",
  truck: "M2 6h12v10H2zM14 10h4l3 3v3h-7M6 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  calendar: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4",
  addressBook: "M6 2h13v20H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 17a4 4 0 0 1 8 0M2 7h3M2 12h3M2 17h3",
  // Lighting (Granvelo). `eye` (Blind) and `curtain` (Show) already exist above.
  /** Blackout: a circle crossed out. */
  blackout: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  /** Fade to black: the light goes down to the floor line. */
  ftb: "M3 5h4l10 13h4M3 21h18",
  /** Emergency: triangle with an exclamation mark (same drawing as `alert`, its own name for the safety command). */
  emergency: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  /** Bench (Banco): three faders with their handles. */
  bench: "M6 3v18M12 3v18M18 3v18M4 15h4M10 8h4M16 12h4",
  /** Stage (Allestimento): the stage floor with a truss and two lights above. */
  stage: "M3 20l3-6h12l3 6zM4 4h16M8 4v3M16 4v3",
  /** A plug: the DMX output (cable to the lights). */
  plug: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 15, strokeWidth = 2, color, filled, className, style, title }: IconProps) {
  const isFilled = filled ?? name.endsWith("F");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFilled ? color ?? "currentColor" : "none"}
      stroke={isFilled ? "none" : color ?? "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      style={{ flex: "none", ...style }}
    >
      {title ? <title>{title}</title> : null}
      <path d={ICONS[name]} />
    </svg>
  );
}

export interface AppLogoProps {
  /** Path drawn with the app accent (upper mark). */
  accentPath: string;
  /** Path drawn with the ink colour (lower mark). */
  inkPath: string;
  size?: number;
  label: string;
  /** Line width on the 100×100 grid; by default it grows as the tile gets smaller. */
  strokeWidth?: number;
  /** Filled dots in the accent colour (Cue: the dot on the script). */
  accentDots?: readonly { cx: number; cy: number; r: number }[];
}

/** App icon tile: light tile, accent + ink line marks (see 02_design.md). */
export function AppLogo({ accentPath, inkPath, size = 22, label, strokeWidth, accentDots }: AppLogoProps) {
  const stroke = strokeWidth ?? (size < 24 ? 4.5 : size <= 64 ? 3.4 : 3);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label} style={{ flex: "none" }}>
      <rect x="1" y="1" width="98" height="98" rx="23" fill="var(--tile)" stroke="var(--tile-border)" strokeWidth="2" />
      <path d={inkPath} fill="none" stroke="var(--logo-ink)" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      {accentPath && <path d={accentPath} fill="none" stroke="var(--logo-a)" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />}
      {accentDots?.map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="var(--logo-a)" />)}
    </svg>
  );
}

/**
 * Granvelo icon "Banco" (100×100, 02_design.md): three faders in ink and three handles in the accent, thick
 * stroke. Use with `AppLogo` and `strokeWidth={GRANVELO_LOGO.stroke(size)}`; `tools/make_icons.mjs` of the app
 * draws the same geometry with the same strokes.
 */
export const GRANVELO_LOGO = {
  accent: "M20 62H36M42 34H58M64 50H80",
  ink: "M28 18V82M50 18V82M72 18V82",
  /** 6 on the 100×100 grid (6.4 at 64 px, 8.5 at 32 px, 9.5 at 24 px, 11 at 16–20 px). */
  stroke: (size: number): number => (size <= 20 ? 11 : size <= 24 ? 9.5 : size <= 32 ? 8.5 : size <= 64 ? 6.4 : 6),
} as const;

/**
 * Cue icon "Filo" (100×100, 02_design.md): the dot on the script (filled, logo colour #77726A), the line and the
 * GO button (ink, outline only). Use with `AppLogo accentPath="" accentDots={CUE_LOGO.dots}
 * inkPath={CUE_LOGO.ink} strokeWidth={CUE_LOGO.stroke(size)}`; `apps/cue/tools/make_icons.mjs` draws the same.
 */
export const CUE_LOGO = {
  accent: "",
  dots: [{ cx: 22, cy: 50, r: 10 }],
  /** Line M33 50H50 and the button rect x50 y35 w32 h30 rx9 (outline). */
  ink: "M33 50H50M59 35H73A9 9 0 0 1 82 44V56A9 9 0 0 1 73 65H59A9 9 0 0 1 50 56V44A9 9 0 0 1 59 35Z",
  /** 6 on the 100×100 grid (8.5 up to 32 px, 11 at 16–20 px). */
  stroke: (size: number): number => (size <= 20 ? 11 : size <= 32 ? 8.5 : 6),
} as const;
