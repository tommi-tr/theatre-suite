# Diaframma extension for Chrome

Optional. With it, Diaframma's Rehearsal mode controls **each Chrome tab**
separately (play/pause, next, previous, volume, speed). Without it, Chrome
counts as a single player.

The extension talks **only to Diaframma on the same computer**
(`ws://127.0.0.1:47811`), and only while “Chrome extension” is turned on in
Diaframma's Settings. It sends nothing to the internet.

## Install (until it is published on the Chrome Web Store)

1. Download the artifact **Diaframma-Chrome-extension** from GitHub Actions and unzip it.
2. In Chrome open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.
5. In Diaframma: Settings → Connections → turn on **Chrome extension**.
