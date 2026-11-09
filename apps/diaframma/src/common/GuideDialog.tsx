import { useT } from "@theatre-suite/core";
import { Button, Dialog, Kbd } from "@theatre-suite/ui";

const KEYS: Array<[string, string]> = [
  ["Space", "GO: starts the attention track"],
  ["P", "Pause all / resume all"],
  ["1 … 99 + Enter", "Puts that track in attention"],
  ["↑ ↓", "Moves the attention"],
  ["Esc", "Stop all with a quick fade"],
  ["Esc Esc", "Stop all at once"],
  ["Ctrl L", "Locks or unlocks the cue list"],
  ["Ctrl S", "Save"],
  ["Ctrl O", "Open a cue list"],
  ["Ctrl Z / Ctrl Y", "Undo / Redo"],
  ["F1", "This guide"],
];

export function GuideDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      title={t("Guide")}
      icon="book"
      onClose={onClose}
      width={640}
      description={t("Diaframma has three modes: Show, to play your cue list; Rehearsal, to control the players open on this computer; Launchpad, sounds on the keys of the keyboard.")}
      footer={
        <>
          <span className="ts-spacer" />
          <Button variant="primary" icon="check" onClick={onClose}>
            {t("Got it")}
          </Button>
        </>
      }
    >
      <div className="df-guide">
        <h3>{t("Show mode in four steps")}</h3>
        <ol>
          <li>{t("Drop audio files onto the list, or press Add track and Load.")}</li>
          <li>{t("For each track you can choose an Entry (Fade in), an Exit (Fade out, Crossfade or Next) and Loop. They are all optional.")}</li>
          <li>{t("Click a track, or type its number and Enter, to put it in attention (amber): it is the next to start.")}</li>
          <li>{t("Press Space for GO. The track on air turns green. Lock the list during the show.")}</li>
        </ol>
        <h3>{t("How GO works")}</h3>
        <p>{t("GO always starts the attention track, with its Entry if it has one. The track that was on air leaves with its own Exit: Fade out fades it, Crossfade crosses it with the new one, Next cuts it. A track without an Exit does what Settings says (a quick fade, by default). If the track on air has Crossfade or Next, the attention track starts by itself when it ends: the box turns green and says it starts by itself. Loop keeps a track repeating until the next GO. While everything is paused (P), GO resumes.")}</p>
        <h3>{t("Editing a track")}</h3>
        <p>{t("Open a track with the arrow on the left. Under the faders (equalizer, volume, pan) press Edit: in the big window each group (start and end cut, volume curve, loop cut, pan) can be changed on its own, reset, ignored or hidden. Hidden or ignored, it keeps its settings.")}</p>
        <h3>{t("Launchpad")}</h3>
        <p>{t("Open the Launchpad screen: drag a sound from the list onto a key of the drawn keyboard. Hold Ctrl to see the second level of the keys. Click a key to change its sound: how it plays (while held, to the end, press again to stop), loop and volume. Turn on Launchpad active to keep the keys working also in Show and Rehearsal mode.")}</p>
        <h3>{t("Rehearsal mode")}</h3>
        <p>{t("See the players open on this computer (Spotify, browser, media player…), pause or skip them, and drag the dot under each one onto an output: LIVE is heard by everyone, PRE-LISTEN only by you.")}</p>
        <h3>{t("Phone and Chrome (optional)")}</h3>
        <p>{t("Phone: press the Phone button, turn it on and scan the QR code with a phone on the same Wi-Fi. It shows the same things as the computer. Chrome: download the extension from Settings → Connections and turn it on to control each tab separately. Both stay off until you turn them on.")}</p>
        <h3>{t("Is my cue list reliable?")}</h3>
        <p>{t("Settings → Test plays your cue list without sound, several times in a row and much faster, and tells you in plain words whether every GO does what you set up.")}</p>
        <h3>{t("Keyboard")}</h3>
        <table className="df-guide__keys">
          <tbody>
            {KEYS.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <Kbd>{k}</Kbd>
                </td>
                <td>{t(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t("Your files are safe")}</h3>
        <p>{t("Diaframma saves your work automatically every few seconds and restores it after a crash. Audio files are never changed: Diaframma only reads them.")}</p>
      </div>
    </Dialog>
  );
}
