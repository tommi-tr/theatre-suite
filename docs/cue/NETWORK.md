# Cue — primary/secondary link (phase 3)

Spec: `13_cue.md` ("Primario e secondario", "Doppio GO", "Schermata Show"). Code: `apps/cue/src-tauri/src/net/`
(Rust), `apps/cue/src/model/link.ts` (pure rules and texts), `apps/cue/src/lib/link.ts` (wrapper + browser simulation).

## Principles
- **Off until the user picks a role** (Settings → Collegamento: Nessuno · Primario · Secondario). The role is remembered
  in `link.json` (Cue's data folder, per instance); with "Nessuno" no socket is open.
- The **primary is the only executor** (CORE.md): the secondary sends requests; the primary applies them through the
  same code path as its keys and publishes state and events. The secondary never drives engines.
- Only the paired computer, only the local network: IPv4 link-local 169.254/16, private 10/8, 172.16/12, 192.168/16
  (127.0.0.1 only for two instances on one computer). TTL 1. Every message signed. Nothing leaves the local network.
- **Firewall**: Windows asks the first time Cue listens. The UI must explain it *before* the first `configure` with a
  role when `firewallNoticeSeen` is false (suggested text: "Windows ti chiederà se Cue può usare la rete: scegli
  Consenti sulle reti private. Cue parla solo con l'altro computer abbinato."). Cue never changes the firewall.
- GO latency on the primary never depends on the network: own threads (receiver, 20 ms ticker, file server, fetch).

## Ports
| | Port | Use |
|---|---|---|
| UDP | 47810 | discovery, pairing, heartbeats, requests, state, chat, pointer |
| TCP | 47811 | show transfer (primary listens) |

`--instance n` adds `10·(n−1)` (instance 2: 47820/47821). With `n ≥ 2` or a debug build, 127.0.0.1 is accepted and the
secondary also sends HELLO to the ports of instances 1–5 on 127.0.0.1.

## Messages
Datagram = JSON `{v:1, kind, seq, sender, ts, payload, mac}`; `mac` = HMAC-SHA256 over the exact bytes of the object
without the `mac` field. `seq` from 1 per session (retransmissions get a new one); `ts` = sender clock in µs;
`sender` = 32-hex computer id. Max 48 KB. Received: wrong MAC, wrong peer, other version, or `seq` seen / older than
1024 behind the highest → dropped (replays and the second copy on the Wi-Fi path).

| Kind | Key | Direction | Payload |
|---|---|---|---|
| `hello` | open / pair key | S→broadcast | `{name, nonce, paired}` (every 500 ms while not connected; both an open and, if paired, a signed one) |
| `offer` | open | P→S | `{name, nonce, pairing, busy, attemptsLeft}` |
| `pair` | HMAC(code, nP‖nS) | S→P | `{name, nonceP, nonceS}` (resent every 300 ms, up to 3 s) |
| `pairFail` | open | P→S | `{reason: code|attempts|busy, attemptsLeft}` |
| `welcome` / `accept` | pair key | P→S | `{name, nonce, echo}` (new pairing / reconnection) |
| `hb` | session | both, 100 ms | `{n, echo, held, lost, name}` + primary: `{holder, taken, avail, wifi}` |
| `rel` / `ack` | session | both | `{rid, chan, body}` / `{rid, ok, reason?}` |
| `state` | session | P→S | `{rev, state}` at each publish and every 1 s |
| `ptr` | session | both | `{pointer}` (low priority) |
| `probe` | session | S→broadcast | `{}` every 1 s with Wi-Fi backup on (finds new paths) |
| `bye` | session | both | `{forget?}` (closing / forgetting: the other side shows "lost" at once) |
| `fetch` | session | S→P (TCP) | `{transferId, names}` |

Reliable channels (`rel`): `req` (S→P requests), `evt` (P→S events), `result` (P→S later refusal), `chat` (both, low
priority), `file` (P→S manifest), `fileDone` (S→P). Retry every 100 ms, give up after 1 s; the receiver answers a
repeated `rid` with the same ack without applying it again.

## Pairing
1. Primary with no pairing shows a 6-digit code (`getrandom`), with a nonce nP. The secondary's HELLO gets an `offer`.
2. The user types the code on the secondary: pair key `K = HMAC-SHA256(code, nP‖nS)`; `pair` is signed with K.
3. The primary checks the MAC (5 wrong codes → new code), stores `{peerId, peerName, key}` and answers `welcome`.
4. Every connection uses a fresh **session key** `HMAC-SHA256(K, "cue-session"‖nP‖nS)`: next time a signed HELLO →
   `accept` with new nonces, no code. "Dimentica" clears it on both sides (`bye {forget}`).

Note: a 6-digit code without a PAKE can be brute-forced offline by someone who recorded the pairing exchange on the
same network. Acceptable on a direct cable; a PAKE (e.g. SPAKE2) is an open point. Messages are signed, not encrypted.

## States and thresholds (`net/health.rs`)
| Status | When | Panel / border |
|---|---|---|
| `none` | no secondary connected yet | neutral, no border: "Nessun secondario" |
| `stable` | heartbeats on time | soft green (`--go-bg`), border green 55 %: "Connesso · 0,4 ms", "Via cavo · disponibile" |
| `unstable` | avg RTT (last 10) ≥ **20 ms** or ≥ **2** heartbeats lost in **2 s**; back to stable after **2 s** clean | full amber: "Instabile · 38 ms, 3 battiti persi" |
| `backup` | the cable path is silent, the Wi-Fi path answers | full amber: "Ora su Wi-Fi di riserva" |
| `lost` | no valid message for **1 s** (or `bye`) | full red, white text: "Scollegato da 0:04" + side sentence |
| `unavailable` | secondary pressed "Non disponibile" | full blue: primary "Non disponibile · sei solo"; secondary veil |

Priority: lost > unavailable > backup > unstable > stable. Losses count the worse direction (each heartbeat carries
the sender's inbound loss count). On loss: the secondary's reservation ends at once, pending requests fail
(`notConnected`), the pointer hides; the secondary looks for the primary again (HELLO) and reconnects by itself.

## Requests, reservation, commands
- Requests: `go {standbyId}`, `back`, `pause`, `blackout {on?}`, `fadeToBlack`, `emergency`, `stopAudio`, `standby {goId}`,
  `edit {op}`, `reserve`, `release`, `available`, `unavailable`. The primary's link decides first
  (`decide_request`): commands taken → everything refused except release/available and the safety commands (pause, blackout, fadeToBlack, emergency); primary holds the reservation →
  go/back/standby/reserve refused (safety commands still pass); unavailable → go/back/standby/reserve/edit refused.
  Accepted ones (except reserve/release/availability, handled natively) arrive as `cue-link-event {type:"request"}`;
  the UI applies them with role `"secondary"` and calls `reply(requestId, false, reason)` if playback refuses them.
  `checkRemoteGo` refuses a GO whose `standbyId` already started (both pressed at once): see open points.
- Reservation (key C held): arbitrated on the primary, first wins; `reservation` in the state says who holds it.
- Wi-Fi backup (off by default, set on the primary, mirrored to the secondary): every message goes on all live paths;
  duplicates dropped by `seq`. Without it only the best path (cable) is used.

## Files
`sendShow({showId, tcuePath, extraPaths, showJson?})` after connection and after each edit. Names are relative to the
deepest folder containing all files (relative source paths keep working); videos, missing files and files on another
drive are skipped (`skipped`). The secondary fetches only files with a different SHA-256 into
`<data>/link/received/<showId>/`, writes `<name>.part`, checks SHA-256, renames over its copy (primary wins) and emits
`cue-link-file {phase:"received", path, showJson}`: it opens `path` (using `showJson` when present).

## Native API
Commands: `link_info`, `link_configure({role?, wifiBackup?, manualPeer?, name?})`, `link_new_code`, `link_enter_code(code)`,
`link_forget`, `link_request(op)`, `link_reply(requestId, ok, reason?)`, `link_publish_state(showState)`,
`link_publish_event(event)`, `link_reserve(on)`, `link_take_commands(on)`, `link_chat(text, quick)`,
`link_pointer(pointer|null)`, `link_send_show(request)`.
Events: `cue-link-state` (LinkInfo, on change and every 500 ms), `cue-link-event` (`request`, `state`, `event`, `result`,
`paired`, `forgotten`), `cue-link-chat` (`{id, text, quick, at, from, name, mine}`), `cue-link-pointer`, `cue-link-file`.

## What the UI must do
1. Settings → Collegamento: role, firewall explanation first, code display (primary) / code field (secondary,
   `found`), manual IP, Wi-Fi backup, name, "Dimentica"; show `error` (`portBusy`).
2. Show: `linkPanel(info, t, lang, Date.now())` for the right panel and the 6 px border (re-render every second while
   lost); veil + HoldButton on the secondary when unavailable; `reservationView` for the blue ribbon / grey standby;
   `givenByLabel` and `playbackRole(info)` for `goViews`.
3. Every action through `routeAction`: `local` → apply; if `broadcast`, `publishState(snapshot)` and
   `publishEvent(firedEvent(...))`; `remote` → `request(op)`, show `refusalText` when refused; `refuse` → show it.
4. Primary: handle `request` events like keys; `sendShow` on connect and after edits. Secondary: apply `state` events
   to its display, open the received file.
5. Chat (quick replies + text) and pointer (`pointer({page,x,y})` throttled by the native side to 10 Hz).

Demo (`/?demo`): `&link=stable|unstable|backup|lost|unavailable|pairing`, add `secondary`, `reserved-me`,
`reserved-other`, `taken` (e.g. `/?demo&link=secondary,unavailable`); `window.__cueLink.set({...})` at run time.

## Testing with two instances on one computer
Full steps in `README.md` ("Step by step"). In short: `pnpm --filter cue tauri dev` (instance 1, choose Primario, press
"Ho capito, attiva"), then `<target dir>/debug/cue --instance 2` (choose Secondario, type the code shown by instance 1).
With two release builds start both with `--instance` (2 and 3): instance 1 of a release build accepts no loopback.
Automated: `cargo test -p cue --test link` (pairing, wrong code, heartbeat, request -> state, reservation, commands taken
with safety commands still accepted, chat, file transfer, bye and silent loss, remembered pairing, forget) and
`pnpm --filter cue exec vitest run` (`routeAction`, panel states, `handleRequest`, edits).

## How the UI uses it (Cue 0.4.0)
- `store/link.ts` holds `LinkInfo`, the chat and the remote pointer; `lib/linkRuntime.ts` (`startLink`, from the Shell)
  wires events: `request` -> `handleRequest` (`show/run.ts`, same code as the keys, role "secondary"; a playback refusal ->
  `reply(requestId, false, reason)`), `state` -> `applySharedRun`, `cue-link-file received` -> opens the show and shows the
  banner. The primary publishes `sharedRun` (playback, running time, preset, autoPending) after every change and `fired`
  events; the secondary never runs engines (`run()` returns at once for a real secondary).
- Edits on the secondary: after 400 ms the changed top-level parts of `show.json` (`gos`, `notes`, `speedZones`, `layout`,
  `projection`, `checklist`, `settings`) go as `{kind:"edit", op:{type:"patch", set}}`; the primary validates them with
  `parseShow`, applies them and `sendShow`s the new `showJson` (600 ms debounce), which the secondary applies silently.
  The whole show is never sent in a datagram (48 KB limit).
- `emergency` from the secondary toggles (on, or back to the show). Preset (Q) is primary-only.
- UI: `settings/LinkPane.tsx`, `show/LinkPanel.tsx` (panel, 6 px border, unavailable veil, reservation band, chat),
  `show/RemotePointer.tsx`. Keys are off on a secondary "Non disponibile".

## Open points
- `checkRemoteGo` refuses a secondary GO for a standby already started (prevents a double GO when both press at once):
  confirm with the director (13 says "no time-based safety net"; this check is not time-based).
- (Decided) Safety commands (Pausa, Blackout, Fade to black, Emergenza) are accepted from the secondary even with the commands taken away.
- PAKE instead of a plain code; encryption not planned.
- Several primaries on one network: the secondary keeps the first found (a primary showing a code wins).
