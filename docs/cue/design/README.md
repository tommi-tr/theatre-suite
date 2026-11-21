# Cue — design preview (fase D, approved)

`preview.html` is the interactive preview (open it in a browser; Geist fonts load from Google Fonts, with a system-ui fallback offline). Screenshots below were rendered at a 1366x768 viewport, dark theme unless noted, with "Gesso" accent, "Filo" icon and "Ciano fascio" projection colour.

## Images

- `design-choices.jpg` - accent choices (Gesso/Tabacco/Malva) and icon choices (Filo/Rami/Libro di scena).
- `show-primary-stable-dark.jpg` - Show on the primary computer, link stable, green border, panel "Connesso · 0,4 ms".
- `show-link-unstable.jpg` - link unstable: amber border and amber panel ("Instabile · 38 ms, 3 battiti persi", Wi-Fi fallback).
- `show-link-lost.jpg` - link lost: red border and red panel ("Scollegato da 0:04"), primary view.
- `show-primary-secondary-unavailable.jpg` - secondary "Non disponibile": blue border/panel, primary sees "Non disponibile · sei solo".
- `show-secondary-unavailable.jpg` - same state on the secondary: blurred cover with "Tieni premuto per tornare disponibile".
- `show-reserved-by-me.jpg` - standby reserved by the user (key C): blue outline on STBY 14 and blue ribbon.
- `show-reserved-by-other.jpg` - standby reserved by the other computer: grey button "14 · Prenotato dal secondario".
- `show-go-assigned.jpg` - GO assigned to the other computer only: grey button "14 · lo dà il secondario".
- `show-peek.jpg` - peek (Ctrl held): script scrolled ahead, dashed "qui eri · STBY 14" line, ribbon "Sbirciata".
- `show-no-secondary.jpg` - no secondary paired: no border, panel "Nessun secondario".
- `show-light-theme.jpg` - Show in the light app theme.
- `link-border-states.jpg` - the four border/link states side by side (stable, unstable, lost, unavailable).
- `prepare.jpg` - Prepara: libraries left, script/timeline centre, GO inspector ("Chi lo dà") right, drag ghost, speed zones.
- `projections.jpg` - Proiezioni: sequence with transitions, output preview, element inspector.
- `controls.jpg` - Controlli: one card per output, "Prima del sipario" checklist.

## Measurable details (from the HTML/CSS)

Layout and sizes
- App mock width 1040 px (Prepara 1270 px); border-radius 14 px; outer border 6 px, transparent unless a secondary is connected.
- Title bar 40 px high with a 3 px bottom stripe `#C24B6A`; status/command bar at the bottom 34 px high.
- Main body 470 px high; right panel 200 px wide (padding 12 px, gap 8 px).
- GO buttons 34 px high, 100 px wide, radius 7 px, border 1.5 px, 12.5 px semibold; left edge at x=316.
- Script paper column 290 px wide; the GO dot sits at its right edge (r 4.5 px, active r 5.5 px); lines 1.5 px (idle) / 2.5 px (active), curved when GOs are close (GO 16).
- Timeline columns 120 px wide at x=440 (Luci), 566 (Audio), 692 (Video); boxes radius 8 px, 3 px coloured top bar, active border 2 px.
- Prepara: library 210 px, inspector 230 px; Proiezioni: sequence 270 px, inspector 230 px; Controlli: checklist 300 px, cards in 3 columns.
- Speed-zone strips on the script margin: 8 px wide; reserved GO ring: 3 px blue; selected GO ring: 2 px accent.
- Base font 13 px; kbd badges 11 px mono with 2 px bottom border.

Colours (dark / light)
- Background `#0E0F12` / `#ECEEF2`; bar `#131418` / `#F7F8FA`; surfaces `#18191E`, `#202228`, `#2A2D35` / `#FFFFFF`, `#F2F3F6`, `#E5E7EC`; borders `#272A31`, `#383C46` / `#DCDFE5`, `#C3C8D1`.
- Text `#ECEDF0`, `#A7AAB3`, `#878B95` / `#14151A`, `#4A4E58`, `#5F6470`.
- Semantic: green (in scena, connected) `#34D17B` / `#0B7D3E`; amber (standby, unstable) `#FFB224` / `#955700`; red (lost, emergency) `#FF5F5F` / `#C42B2B`; blue (reserved, "sei solo") `#4FA8FF` / `#1463C4`. Tinted backgrounds: `#15301F`, `#3A2C0D`, `#3A1A1C`, `#172638`.
- Column colours: Luci `#F06FCF` / `#A3218A`; Audio `#8E80FF` / `#5442E0`; Video (projection cyan) `#4CD6E6` / `#0A7886`.
- Cue accent "Gesso": `#E2DED4` dark / `#4B4840` light (soft `#2B2A26` / `#ECEAE4`); icon tint `#77726A`.
- Script paper: white `#fff` or dark `#1c1d21` (independent of the app theme).
- Connected border is green at 55% opacity; the other states use the full colour.

Fonts
- Geist (400-700) for UI, Geist Mono (400/500) for numbers, times, shortcuts and fields.

Italian labels (exact)
- Top tabs: Prepara, Proiezioni, Controlli, Show. Version `0.1.0`. Project line: "La locandiera / Serata.tcue".
- Column titles: Luci, Audio, Video. Badges: "● IN SCENA", "● STANDBY". GO labels: "GO 13", "STBY 14", "15", "16".
- Bottom bar (Show): "Running time 1:12:40 · GO 13 di 62"; commands Pausa P, Piazzato Q, Tappo T, Blackout B, Fade to black F, Emergenza E E (red).
- Right panel: "Sei il primario · Secondario" / "Sei il secondario · Primario"; "Connesso · 0,4 ms", "Via cavo · disponibile", "Togli i comandi", "Non disponibile"; heading "Chat"; quick replies Standby, Aspetta, Ok, Ritardo 5 min; input "Scrivi…".
- Link texts: "Instabile · 38 ms, 3 battiti persi", "Scollegato da 0:04", "Non disponibile · sei solo", "Nessun secondario".
- Prepara: tabs Luci/Audio/Video; "Trascina sul copione per creare un GO"; inspector "Azioni", "Chi lo dà" (Entrambi / Primario / Secondario), "Zona di velocità"; bar "Nuovo GO qui N", "Nota K", "Prova a secco".
- Proiezioni: "Sequenza", "+ Immagini, video o PowerPoint", "Transizione in entrata" (Taglio / Dissolv. / Nero), "Colore · solo questo elemento".
- Controlli: "Prima del sipario", "+ Aggiungi una voce", "Tutto pronto tranne 3 voci".
