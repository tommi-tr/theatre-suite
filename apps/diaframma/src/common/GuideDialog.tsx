import { useT } from "@theatre-suite/core";
import { Button, Dialog, Kbd } from "@theatre-suite/ui";

const KEYS: Array<[string, string]> = [
  ["Space", "GO: does what is in standby"],
  ["P", "Pause all / resume all"],
  ["1 … 99 + Enter", "Puts that track in standby"],
  ["↑ ↓", "Moves standby"],
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
      description={t("Diaframma has two modes: Show, to play your cues, and Rehearsal, to control the players open on this computer.")}
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
          <li>{t("For each track choose how it starts (Start) and what it does at its end or when you press GO while it plays (At end or Space).")}</li>
          <li>{t("Click a track, or type its number and Enter, to put it in standby (amber).")}</li>
          <li>{t("Press Space for GO. The playing track turns green. Lock the list during the show.")}</li>
        </ol>
        <h3>{t("How GO works")}</h3>
        <p>{t("GO looks at the track playing in front. With Next or Crossfade it goes straight to the track in standby. With Stop, Fade out or a loop, the first GO stops, fades or goes into the loop, and the next GO plays the track in standby: the standby box shows both steps. While paused (P), GO resumes; a click on the waveform first moves the play position.")}</p>
        <h3>{t("Launchpad")}</h3>
        <p>{t("Turn it on with the Launchpad button at the top. Each sound has keys of your choice (for example Num 1, or L + 1) and plays while held, to the end, or until pressed again. Diaframma comes with standard sounds (thunder, doorbell, phone, alarm…); add your own with Add sound.")}</p>
        <h3>{t("Rehearsal mode")}</h3>
        <p>{t("See the players open on this computer (Spotify, browser, media player…), pause or skip them, and choose which output each one uses: LIVE is heard by everyone, PRE-LISTEN only by you.")}</p>
        <h3>{t("Phone and Chrome (optional)")}</h3>
        <p>{t("Phone: press the Phone button, turn it on and scan the QR code with a phone on the same Wi-Fi. Chrome: install the Diaframma extension and turn it on in Settings to control each tab separately. Both stay off until you turn them on.")}</p>
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
