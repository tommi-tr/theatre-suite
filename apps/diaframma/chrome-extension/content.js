// Diaframma extension — content script (every frame of every tab).
// Reports the state of the page's audio/video and applies Diaframma's commands.
(() => {
  if (window.__diaframma) return;
  window.__diaframma = true;

  const media = () => Array.from(document.querySelectorAll("video, audio")).filter((m) => m.currentSrc || m.src || m.srcObject);
  const main = () => {
    const list = media();
    return list.find((m) => !m.paused) || list.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] || null;
  };

  function state() {
    const m = main();
    if (!m) return null;
    const host = location.hostname;
    const nextBtn = document.querySelector(".ytp-next-button, [data-testid='control-button-skip-forward']");
    return {
      paused: m.paused,
      currentTime: Number.isFinite(m.currentTime) ? m.currentTime : 0,
      duration: Number.isFinite(m.duration) ? m.duration : null,
      volume: m.muted ? 0 : m.volume,
      playbackRate: m.playbackRate,
      hasNext: !!nextBtn,
      site: host,
      title: navigator.mediaSession?.metadata?.title || document.title,
      artist: navigator.mediaSession?.metadata?.artist || "",
    };
  }

  let lastSent = "";
  function report() {
    const s = state();
    const key = JSON.stringify(s && { ...s, currentTime: Math.round(s.currentTime) });
    if (key === lastSent) return;
    lastSent = key;
    chrome.runtime.sendMessage({ type: "diaframma-media", state: s }).catch(() => {});
  }
  setInterval(report, 1000);
  document.addEventListener("play", report, true);
  document.addEventListener("pause", report, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "diaframma-cmd") return;
    const m = main();
    if (!m) return;
    switch (msg.action) {
      case "toggle":
        if (m.paused) m.play().catch(() => {});
        else m.pause();
        break;
      case "pause":
        m.pause();
        break;
      case "next": {
        const b = document.querySelector(".ytp-next-button, [data-testid='control-button-skip-forward']");
        if (b) b.click();
        else m.currentTime = Math.min((m.duration || Infinity) - 0.1, m.currentTime + 10);
        break;
      }
      case "prev":
        if (m.currentTime > 3) m.currentTime = 0;
        else {
          const b = document.querySelector(".ytp-prev-button, [data-testid='control-button-skip-back']");
          if (b) b.click();
          else m.currentTime = 0;
        }
        break;
      case "volume":
        if (typeof msg.value === "number") {
          m.muted = false;
          m.volume = Math.max(0, Math.min(1, msg.value));
        }
        break;
      case "speed":
        if (typeof msg.value === "number") m.playbackRate = Math.max(0.25, Math.min(4, msg.value));
        break;
      case "seek":
        if (typeof msg.value === "number") m.currentTime = Math.max(0, msg.value);
        break;
    }
    setTimeout(report, 150);
  });
})();
