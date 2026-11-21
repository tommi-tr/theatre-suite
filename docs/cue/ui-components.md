# Componenti condivisi in `packages/ui` (da copiare in 02_design.md)

- **KeyCommand** (`children`, `keys`, `variant: "normal" | "danger"`, `active`, `armed`, `icon`) e **KeyCommandBar**: pulsante di comando con il tasto scritto sopra, e la barra che li raccoglie.
- **OutputPill** (`state: ok | warn | stop | info | idle`, `label`, `detail`, `busy`, `open`, `chevron`, `onClick`): stato di un'uscita (luci, audio, video) con luce colorata e parole.
- **AlertBand** (`tone: stop | warn | info`, `title`, `children`, `action`, `icon`): fascia sotto la barra del titolo per problemi o avvisi.
- **SettingsLayout** (`categories {id,label,icon}[]`, `active`, `onSelect`, `label`, `height` fissa con scorrimento oppure `minHeight`, `children`): corpo della finestra Impostazioni, categorie a sinistra e pannello a destra. Va dentro `Dialog` (larghezza 820).
- **SettingsFooter** (`text`, `doneLabel`, `onDone`): piè di pagina con la versione a sinistra e il pulsante "Fatto".
- **SettingsRow** (`label`, `hint`, `children` = controllo) e **SettingsSection** (`title`, `description`, `badge`, `children`): una voce di impostazione e un blocco di pannello.
- **ComingSoonCard** (`icon`, `label` = testo della pillola, `title`, `items` = elenco puntato, `children` = "nel frattempo", `compact`) e **ComingSoonPill** (`label`): la scheda "Parte non ancora disponibile".
- Stili: classi `ts-settings*`, `ts-set-*`, `ts-soon*` in `theme.css`. Cue e Granvelo usano SettingsLayout/SettingsRow con resa identica a prima; Cue usa anche ComingSoonCard (la scheda di Granvelo, con larghezza massima 620, non è ancora migrata).
