// Diaframma extension — service worker.
// Keeps a WebSocket to Diaframma on 127.0.0.1 (never to the internet) and relays
// the state of the media in each tab, and Diaframma's commands to the tabs.

const URL_WS = "ws://127.0.0.1:47811/diaframma";
let ws = null;
let connected = false;
const tabMedia = new Map(); // tabId -> { frames: Map(frameId -> state) }

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(URL_WS);
  } catch {
    return;
  }
  ws.onopen = () => {
    connected = true;
    chrome.storage.session?.set({ connected: true });
    ws.send(JSON.stringify({ type: "hello", version: chrome.runtime.getManifest().version }));
    sendTabs();
  };
  ws.onclose = () => {
    connected = false;
    chrome.storage.session?.set({ connected: false });
    ws = null;
  };
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "cmd" && typeof msg.tabId === "number") {
      chrome.tabs.sendMessage(msg.tabId, { type: "diaframma-cmd", action: msg.action, value: msg.value }).catch(() => {});
    }
  };
}

async function sendTabs() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const tabs = await chrome.tabs.query({});
  const out = [];
  for (const t of tabs) {
    const entry = tabMedia.get(t.id);
    let media = null;
    if (entry) {
      // Prefer the frame that is playing, else any frame with media.
      for (const s of entry.frames.values()) {
        if (!media || (media.paused && !s.paused)) media = s;
      }
    }
    if (!media && !t.audible) continue;
    out.push({ tabId: t.id, title: t.title || "", url: t.url || "", favIconUrl: t.favIconUrl || "", audible: !!t.audible, muted: !!t.mutedInfo?.muted, media });
  }
  ws.send(JSON.stringify({ type: "tabs", tabs: out }));
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "diaframma-media" || !sender.tab) return;
  const tabId = sender.tab.id;
  if (!tabMedia.has(tabId)) tabMedia.set(tabId, { frames: new Map() });
  const frames = tabMedia.get(tabId).frames;
  if (msg.state) frames.set(sender.frameId ?? 0, msg.state);
  else frames.delete(sender.frameId ?? 0);
});

chrome.tabs.onRemoved.addListener((tabId) => tabMedia.delete(tabId));
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "diaframma-status") reply({ connected });
});

chrome.alarms.create("diaframma-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
setInterval(() => {
  connect();
  sendTabs();
}, 1000);
connect();
