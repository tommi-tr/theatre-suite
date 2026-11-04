chrome.runtime.sendMessage({ type: "diaframma-status" }, (r) => {
  const on = !!(r && r.connected);
  document.getElementById("dot").className = on ? "dot on" : "dot";
  document.getElementById("txt").textContent = on ? "Connected to Diaframma" : "Diaframma is not reachable";
});
