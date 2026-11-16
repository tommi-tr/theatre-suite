# 02 — Design e interfaccia

L'identità visiva della suite nasce dalla prima app (Diaframma). Questo documento è il **riferimento dell'identità visiva**: concetti di base, cose già decise, colori e componenti condivisi. Le scelte concrete si aggiungono qui man mano che le approviamo; ciò che è scritto serve a dare coerenza e si può rivedere con un buon motivo. Aggiornato il 16 novembre 2026 (Diaframma 0.3.0, Bardo 0.2.0, launcher 0.4.0, Cantinella 0.9.0, design di Granvelo approvato, **barra del titolo e "Torna al launcher" realizzati**: dettaglio in `11_giro_trasversale.md`).

## Concetti di base
- **Moderna e molto intuitiva.** Interfacce pulite e attuali. Chi apre un'app per la prima volta capisce subito cosa fare: azioni principali evidenti, nomi chiari, pochi passaggi.
- **Una famiglia riconoscibile.** Launcher e app condividono la stessa identità: struttura delle finestre, colori di base, caratteri, componenti, icone. Ogni app ha un tratto distintivo (un colore proprio) per riconoscerla tra le altre. Il launcher mostra le app e i loro documenti con questi stessi segni (icona e colore di ogni app), così si capisce a colpo d'occhio "cosa è di cosa".
- **Pensata per schermi piccoli.** In teatro gli schermi sono spesso piccoli: l'interfaccia è compatta e ordinata, senza sprechi di spazio, ma resta leggibile e comoda da usare.
- **Tema chiaro e tema scuro**, selezionabili dall'utente (e "come il sistema"). Il tema predefinito dipende dall'uso: **scuro** per le app di scena (Diaframma, Granvelo), **chiaro** per le app di scrittura e di ufficio (Bardo, Cantinella).
- **Stato sempre chiaro.** Si capisce sempre cosa sta succedendo, se ci sono modifiche non salvate, se c'è un problema.
- **Uso da tastiera.** Le azioni frequenti hanno una scorciatoia.
- **Accessibilità.** Contrasto sufficiente, focus visibile, mai il colore come unica informazione.
- **Lo spettacolo è sempre riconoscibile.** Quando un'app è aperta dentro un progetto di spettacolo, il nome dello spettacolo si vede nella finestra (sottile fascia + sfumatura del suo colore) e si torna al launcher cliccando il gruppo logo + spettacolo / file (vedi "Barra del titolo"). Le app aperte da sole restano pulite.

## Come si gestisce la grafica (dove vive cosa)
- **Questo documento** dice cosa è deciso. **`packages/ui`** lo realizza: ogni app lo importa e non ridefinisce nulla di ciò che c'è qui.
  - `theme.css`: palette Grafite (scuro e chiaro) come variabili, caratteri Geist inclusi, classi `ts-*` dei componenti.
  - `components.tsx`: componenti React condivisi; `confirm.tsx`: conferme; `launcherLink.ts`: "Torna al launcher".
  - `icons.tsx`: icone lineari e logo delle app.
- **`packages/core`** contiene ciò che non è grafica ma serve a tutte: lingue, formati, annulla/ripeti, e `show.ts`, cioè la lettura dell'indice dello spettacolo (`progetto.theatre`), il **colore dello spettacolo** (`showColor`) e `findShow` (lo spettacolo a cui appartiene un file).
- **Ogni app aggiunge solo il proprio accento**, con `data-app="<nome>"` sull'elemento radice e le variabili `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line` per tema scuro e chiaro (file `app.css` dell'app). Le app di scrittura possono aggiungere variabili per ciò che si vede sulla carta (es. Bardo: `--logo-a`, `--paper-accent`, `--paper-soft`, `--paper-line`).
- **Regola**: se un componente o un colore serve a più di un'app nasce in `packages/ui` e si annota qui; se serve a una sola resta nell'app. Verde, ambra, rosso e blu non si ridefiniscono mai nelle app.
- **Nomi dei file**: mai due file che differiscono solo per le maiuscole (su Windows sono lo stesso file e la build si rompe).
- **Testi**: le chiavi sono i testi inglesi, le traduzioni italiane stanno nei dizionari dell'app. In Cantinella un test controlla che ogni testo abbia la traduzione e che lo stesso testo inglese non sia tradotto in due modi (attenzione alle parole corte con più significati: "Light" è il tema chiaro, il semaforo è "Traffic light"; "Show" è "Mostra", l'ora dello spettacolo è "Show time"). Lo stesso testo inglese si traduce allo stesso modo in tutte le app salvo motivo di contesto. **In Granvelo "Show" è il nome di una modalità** (resta "Show" in italiano, come "GO" e "Blind"): va gestita nel dizionario con una chiave distinta da "Show" = Mostra.

## Componenti e modelli condivisi
**Componenti** (`packages/ui`): Button (varianti primary, ghost, icon, danger, piccolo; stato "on"), Kbd (tasto), Label, Segmented (selettore a segmenti, con etichetta racchiusa per poterla nascondere; ogni segmento ha il suo nome come tooltip), Switch, Range, NumberField (valore che si digita cliccandolo), VFader (fader verticale), Dialog (con `closeLabel`), Toast, TitleBar, StatusBar, HoldButton (tenere premuto per confermare), **ConfirmHost** con `confirmSave` / `confirmYesNo`. Pillole di stato `ts-pill` (go, sb, pre, paused) e punti `ts-dot` coi colori semantici.

### Barra del titolo (regola per tutte le app, realizzata il 16/11/2026)
- **Launcher**: logo + "Theatre Suite" (eccezione: è la casa della suite); versione a destra.
- **Ogni altra app**: in alto a sinistra **solo il logo** (mai il nome del programma), poi **nome dello spettacolo** `/` **nome del file**. Senza spettacolo: logo + nome del file in evidenza. Senza file salvato: "Non ancora salvato".
- **Il gruppo logo + spettacolo / file è il pulsante "Torna al launcher"**: nessun altro logo o icona accanto. Al passaggio del mouse l'intero gruppo prende una tinta tenue del colore dello spettacolo; tooltip "Torna a Theatre Suite · <spettacolo> · Ctrl Maiusc L". Compare solo se lo spettacolo è riconosciuto e il launcher è installato (altrimenti è un'etichetta).
- Sotto: sfumatura del colore dello spettacolo da sinistra (16% → 0 al 45% della larghezza) e fascia piena di 3 px (`ts-titlebar--show`, `ts-showband`). Proprietà: `show` (`{ title, color, dir }`), `onHome` / `homeTitle` (dal hook `useBackToLauncher`), `version` (sempre a destra, prima dei pulsanti della finestra), `fileName`, `saveState`.
- **Azioni a destra solo icona** con tooltip; il menu **File** ha sempre la scritta "File". Quando manca spazio cedono prima il testo di salvataggio e il nome del file (minimo 80 px); il nome dello spettacolo resta leggibile (minimo 90 px).
- **Funzionamento**: l'app avvia il launcher con `--show <cartella>` (crate `suite-link`, vedi 07 e 11); app non installata → nessun pulsante. **Ctrl+Maiusc+L** è la scorciatoia; il Lock di Diaframma (e di Granvelo) è solo Ctrl+L **esatto**.

### Conferme e impostazioni (regola per tutte le app)
- **Conferme in-app** nello stile dell'app, mai pop-up di sistema: "Modifiche non salvate" con **Annulla · Non salvare · Salva** (Invio = Salva, Esc = Annulla); domande sì/no con **Annulla** e l'azione (in rosso se distrugge qualcosa). Dalla 0.3.0 / 0.2.0 / 0.9.0 chiudere la finestra o aprire un file si può annullare davvero.
- **Impostazioni**: Aspetto = **Chiaro · Scuro · Come il sistema**; Lingua = **Italiano · English**; pulsante **Fatto** (con spunta) a destra nel piede della finestra.

**Realizzati il 14/11/2026 con Cantinella 0.1.0:**
- **StatusLight** (`ts-light`): punto + parola nei quattro colori (stati `ok`, `warn`, `stop`, `info`), `strong` per la parola colorata; **StatusLightPicker**: i quattro come selettore (radio).
- **CopyPreview** (`ts-copy`): anteprima fedele in Geist Mono + "Copia" che diventa "Copiato" per 1,8 s; azioni in più accanto (`extra`); la copia vera la fa l'app (`copy`).
- **AppLogo** accetta `strokeWidth` (per i loghi che vogliono un tratto diverso a piccole dimensioni, es. il Telaio a 20 px con tratto 7).
- **Fondi tenui** come variabili in `theme.css`: `--go-bg`, `--sb-bg`, `--sb-row` (righe "da controllare"), `--stop-bg`, `--pre-bg`, `--neutral-bg`; punti `--stop-fill`, `--pre-fill`.

**Realizzato il 15/11/2026 con Cantinella 0.2.0:**
- **StateCell** (`ts-state`, tipo `CellState`): cella di una griglia con colore **e** lettera (S/F/N/–), puntino "c'è una nota", anello di selezione nell'accento, clic che fa girare gli stati. Per ogni tabella "chi/cosa × quando" (disponibilità; in futuro altre app). Usata nella tabella Disponibilità di Cantinella.

**Realizzati il 15/11/2026 con Cantinella 0.5.0:**
- **MoneyField** (`ts-money`): cifra in **centesimi interi**, mostrata all'italiana ("1.234,56") in Geist Mono con "€" a destra; si scrive in ogni modo comune ("1.234,56", "1234.5", "€ 12", "12 €") e il valore cambia uscendo dal campo o con Invio (Esc annulla); testo non valido → bordo rosso e torna il valore di prima. `computed` = valore calcolato da un altro campo: grigio con bordo tratteggiato; scrivendoci dentro diventa lui quello "vero". Funzioni esportate: `formatCents`, `parseCents`, `grossOf`, `netOf`.
- **NetGrossField** (`ts-netgross`): Netto › Lordo con l'aliquota; il campo scritto è quello "vero" (`entered`), l'altro è calcolato e grigio; cambiare l'aliquota non cambia mai la cifra scritta.
- **Steps** (`ts-steps`, tipo `StepTone`): avanzamento a barrette più la parola dello stato; ogni passo ha un tono (`draft` tratteggiato, `neutral`, `info` blu, `ok` verde) e le barrette fino a quello attuale prendono il suo tono; con `onChange` ogni barretta si clicca (radio). Usato per gli stati dei costi (stima → preventivo → confermato → pagato) e delle piazze (contatto → proposta → confermata → fatta).
Restano dentro Cantinella (servono a lei sola): piantina dei posti, schede trascinabili del piano con lucchetto, colonna delle parti, riquadri (`cx-tile`), editor che si apre sotto la riga (`cx-editor`), calendario a mese/settimana/elenco. Se un'altra app ne avrà bisogno, si spostano in `packages/ui`.

**Icone aggiunte** (`packages/ui/src/icons.tsx`): `message` (fumetto, per feedback; 12/11/2026); **`flag`** (bandierina, per i marcatori) e **`history`** (orologio con freccia indietro, per le versioni di un file); 13/11/2026, nate con Diaframma 0.2.1 e disponibili a tutte le app (es. versioni dei copioni di Bardo). **14/11/2026, con Cantinella**: `euro` (Conti), `trafficLight` (semaforo: Reparti), `truck` (Tournée), `calendar`, `addressBook` (rubrica). L'icona `launcher` non serve più (il pulsante "Torna al launcher" è il gruppo logo + nomi). **Per Granvelo (da aggiungere nella fase 0 e nelle successive)**: `eye` (Blind), `blackout` (cerchio barrato), `ftb`, `emergency` (triangolo con punto esclamativo), `bench` (tre fader, per la modalità Banco), `stage` (palco, per Allestimento) e i **simboli delle luci** (vedi sotto e `10_granvelo.md`).

**Modelli di interfaccia nati con Diaframma 0.2.0** (da riusare, non reinventare):
- **Selettore di modalità** in alto al centro (Segmented con simbolo + etichetta): ogni app con più modi di lavoro lo usa (Granvelo: Allestimento · Banco · Show).
- **Barra superiore che si adatta**: con poco spazio i pulsanti restano solo icona (classe `df-bl` che nasconde l'etichetta, con tooltip); mai testi sovrapposti, anche a 1100 px.
- **Fader**: la rotella del mouse li muove passando sopra, senza clic; un valore numerico accanto si può digitare; unità di misura sempre scritte sotto o accanto.
- **Finestre di impostazioni con categorie a sinistra**, titoli e spazi chiari; Guida con le stesse sezioni.
- **Finestre di modifica con gruppi in colonne** e per ogni gruppo gli stessi quattro comandi (Modifica, Reset, Ignora, Mostra/Nascondi): solo il gruppo in modifica è attivo, gli altri sono bloccati. Un gruppo nascosto lo è **ovunque** (anche nella finestra di modifica) e, finché è nascosto, non si modifica.
- **Stato in verde/ambra/rosso/blu** su schede e riquadri (es. riquadro "attenzione" verde quando parte da sola), sempre accompagnato da testo o simbolo.
- Pulsante di una cosa nascosta: "Show" (opposto di "Hide"); parole di teatro comuni (Pause, Stop, Fade in, GO) restano in inglese anche nell'interfaccia italiana.
- **Tastiera disegnata** (Launchpad): tasti con due livelli, il secondo in una fascia colorata con l'accento dell'app.

**Modelli nati con Diaframma 0.2.1** (13/11/2026):
- **Righe senza linee di separazione**: le colonne di una riga si distinguono con etichette e spazio, non con filetti sottili (che davano un'impressione incoerente). Vale per ogni riga a colonne nelle app.
- **Gruppi di comandi 2×2** (`df-grid2`) per accorciare l'altezza di una riga quando i comandi sono quattro o meno.
- **Forma d'onda con tempi sopra e sotto**: la posizione del cursore sopra, in basso gli estremi (IN/OUT) con la durata al centro, così nulla si sovrappone.
- **Marcatori** (bandierina `flag`, tasto M): segni sulla linea del tempo che, se l'opzione "attirano" è attiva, fanno da calamita per i punti trascinati (come in Premiere).
- **Conferma prima di cancellare o svuotare** qualcosa che contiene un lavoro (ora con `confirmYesNo`, vedi sopra).
- **Pulsanti "tutti" in alto** (Pause all, Stop all) con la stessa larghezza e senza andare a capo; il comando per singolo elemento sta sulla sua riga.

**Modelli nati con il launcher 0.3.0** (13/11/2026):
- **Barre di comandi mai su due righe**: se manca spazio si accorcia il testo di stato (con i puntini), non si spostano i pulsanti sotto.
- **Pulsanti di un'intestazione con lo stesso peso**: niente pulsante nero pieno accanto a pulsanti quasi invisibili; il pulsante principale vero (quello che conclude un'azione) resta pieno nelle finestre e nelle schede.
- **Schede in griglia alte uguali** nella stessa riga; righe di testo facoltative occupano comunque il loro spazio.
- **Installare = conferma con conseguenze in chiaro** (cosa viene sostituito, avviso ambra se si torna indietro di versione, cosa viene chiuso) e barra di avanzamento nella scheda.

**Modelli nati con il launcher 0.3.2** (15/11/2026):
- **Pagina con testata + griglia simmetrica**: l'elemento "padrone" (qui il launcher) fa da testata a tutta larghezza; gli elementi pari (le app) stanno in una griglia di schede di pari altezza (2 × 2 con 4 app). Con 5 o più app la griglia va rivista.
- **Note finali senza riquadri**: ciò che non è un'azione né un elemento della griglia (frase offline, crediti, "Scrivici") sta in fondo come un solo testo centrato, senza schede, per non confondersi con gli elementi veri.

**Modelli nati con il design di Cantinella** (13/11/2026; realizzati dal 14/11, completi nella 0.8.0):
- **App a sezioni: sezioni in alto, parti a sinistra.** Le sezioni principali dell'app sono un Segmented (simbolo + etichetta) in una barra sotto la barra del titolo; le parti della sezione scelta stanno in una colonna stretta a sinistra (circa 200 px). È il "selettore di modalità in alto al centro" di Diaframma applicato a un'app con molte sezioni. Le azioni della parte aperta stanno a destra nella stessa barra; per tenere il selettore centrato diventano solo icona (con tooltip) sotto 1440 px; le sezioni diventano solo icona sotto 1100 px.
- **Anteprima prima di confermare** per tutto ciò che l'app interpreta da sola (testo incollato, importazioni): una riga per elemento, le incerte in ambra con la correzione sulla riga stessa e **non spuntate** finché non si correggono o si confermano, il pulsante principale dice quante cose entrano ("Aggiungi 9 risposte sicure"). Applicazioni: importazione della rubrica e "Incolla le risposte".
- **Primo avvio "Da dove vuoi iniziare?"**: schede di pari peso, una per sezione, più "Hai già qualcosa?" (importazioni).
- **Parte non ancora disponibile**: scheda "In arrivo con <App> x.y" con cosa farà e cosa si può preparare intanto; nella navigazione la versione d'arrivo scritta piccola, in una pillola tratteggiata (in Cantinella 0.8.0 non ne restano, il componente resta per il futuro).
- **Stati di avanzamento** (stima/preventivo/confermato/pagato; contatto/proposta/confermata/fatta): neutro tratteggiato → neutro → blu (informativo) → verde, con **Steps** e con la pillola `cx-pill` nelle tabelle.
- **Copiare o esportare dati personali**: per impostazione solo i nomi; telefono, email e dati di produzione (taglie, esigenze, documenti) si aggiungono solo con un interruttore.
- **Tabelle a griglia**: prima colonna fissa, riga dei totali in fondo ("Presenti 6/8 +1 forse"), nessuna linea tra le righe, legenda che sparisce sotto 1240 px, intestazioni e chip mai su due righe; ogni cella ha colore **e** lettera.
- **Riga che si apre sotto** (Costi): la riga in modifica si espande sotto con i campi in griglia e "Elimina" / "Fatto" in fondo, invece di un pannello laterale, quando i campi sono molti e larghi.
- **Riquadri di riepilogo** in testa a una parte (Costi, Riepilogo tournée): 4 riquadri di pari larghezza, etichetta + cifra in Geist Mono + riga di spiegazione; verde per "a posto" (già pagato, saldo positivo), rosso per un saldo negativo, ambra/rosso con bordo per "in scadenza / scadute".
- **Avvisi spiegati**: un elenco a destra (rosso = blocca, ambra = attenzione) con la ragione scritta per intero ("Scena 6 non è mai in programma: manca Enrico in tutte le date"), mai un solo simbolo.
- **Ciò che si sposta a mano resta fissato** (lucchetto) e un comando "Ricalcola il resto" rifà solo il resto: l'automatico propone, la persona decide.
- **Calendario in sola lettura** che raccoglie le date delle altre parti, coi colori: prove nell'accento, spettacoli in verde, tournée in inchiostro, scadenze ambra ("Scade · …") e rosse se scadute ("Scaduta · …"); clic su un evento → apre la parte da cui viene.
- **Promemoria dentro l'app**: una riga sotto la barra del titolo all'apertura del file ("Reparti: 1 cosa scaduta e 3 in scadenza nei prossimi 7 giorni", con "Apri" e "Chiudi"), contatori rossi/ambra nella colonna delle parti. Nessuna notifica di sistema.
- **Stampa / PDF**: un comando "Stampa" apre la stampa di sistema con una pagina semplice (titolo, sottotitolo, tabelle) solo per la carta; su Windows "Microsoft Print to PDF" fa il PDF.

**Modelli nati con il design di Granvelo** (approvati il 16/11/2026; da realizzare dalla fase 0). Anteprima: https://claude.ai/artifact/SKcCiWaAjvocz6wt9EEmiN; dettagli per schermata in `10_granvelo.md`.
- **Blind = blu**: modificare una memoria vedendola solo in anteprima è "lo vedi solo tu", quindi blu con la scritta BLIND (stesso significato del preascolto di Diaframma). Il **pulsante Blind** sta a destra nella barra superiore **accanto a Lock** (Ctrl B); attivo diventa blu e compare una **fascia blu a tutta larghezza** sotto la barra ("BLIND · Stai modificando la memoria 8. Il palco non cambia"), con "Esci da Blind · Esc"; l'anteprima ha il bordo blu e a lato un riquadro verde di ciò che è davvero sul palco.
- **In onda verde, prossima ambra** nello Show (come la traccia in onda e l'attenzione di Diaframma): riquadri con bordo da 2 px nel colore, fondo tenue (`--go-bg`, `--sb-bg`), etichetta IN ONDA / PRONTA in maiuscolo con punto. Il **riquadro della transizione** tra i due ("Crossfade 4 s") ha una barra che si riempie in verde durante il crossfade.
- **Comandi di sicurezza a sola scritta con il tasto, in fondo**: Blackout `B`, Fade to black `F` (con il tempo), Emergenza `E E` (rossa, "premi due volte"). Stanno nella barra in basso e non occupano la schermata; GO, Indietro e Pause restano pulsanti grandi. Nuovo componente per i **comandi a scritta** (testo + `Kbd`), da creare in `packages/ui` se servirà ad altre app.
- **Fader per luce con il colore della luce**: riempimento del fader nel colore della luce, campione colorato (quadratino arrotondato) accanto al nome del canale, numero DMX piccolo sotto; il valore diventa ambra se è stato modificato rispetto alla memoria. Il fader (`VFader`) deve poter accettare un colore di riempimento (eccezione sotto).
- **Simboli delle luci**: un simbolo piatto a tratto per ogni tipo di luce (PAR tondo, PC con bandiere, sagomatore, testa mobile cilindro con forcella e base, barra LED, strobo, fumo), con lente colorata per le luci a colori; stati: normale, selezionata (riquadro nell'accento), conflitto (ambra), non usata (tratteggiata). Percorsi in `10_granvelo.md`.
- **Selettore di visualizzazione del banco su una riga propria** (No · Mini · Compatto · Esteso): un selettore non va mai sovrapposto al contenuto che governa; la modalità più larga si dispone sotto a tutta larghezza.
- **Elenco con simbolo + numero + nome + indirizzo** (luci) e **elenco memorie con miniatura** (numero, miniatura 34×20, nome, nota); la riga in scena è verde, quella in Blind blu, quella "pronta" ambra.

## Già deciso
- Icone delle app con **sfondo chiaro**, tutte della stessa famiglia stilistica.
- Tema chiaro/scuro selezionabile.

## Idee da valutare app per app
Possibilità tipiche dei software teatrali, da proporre **solo dove servono davvero**:
- una modalità "spettacolo" che protegge da modifiche accidentali (in Diaframma esiste: Lock; previsto anche in Granvelo);
- una visualizzazione con luminosità molto ridotta per l'uso al buio;
- un tasto rapido per il comando principale (per esempio la barra spaziatrice per "GO");
- grandi orologi o timer leggibili a distanza.

## Launcher (design scelto il 9 novembre 2026, rivisto il 12, 13 e 15 novembre, realizzato)
Struttura e funzioni in `07_launcher_e_progetti.md`.
- **Accento neutro**: il launcher non ha un colore proprio (grafite/bianco). Il colore appartiene alle app e compare dove c'è un loro documento.
- **Icona del launcher**: tessera chiara con quattro tratti brevi, uno per app: **indaco (Diaframma), rame (Bardo), ardesia #55627E (Cantinella), magenta #C2349F (Granvelo; dalla 0.4.0, prima era un petrolio segnaposto; immagini rigenerate)**. Le immagini si rigenerano con `pnpm --filter launcher icons` (`apps/launcher/tools/make_icons.mjs`); il disegno in pagina è `LauncherMark` in `AppLogos.tsx`.
- **Home**: **Suite in alto** come una riga di schede (icona, nome, ruolo, versione con lucchetto se "tenuta", "Apri"; filetto a sinistra nel colore dell'app, spento se non installata), a destra dell'intestazione SUITE il pulsante **"Esplora, installa e aggiorna"** (puntino ambra se c'è un aggiornamento). **Spettacoli sotto**: "Ordina per" (menu), "Apri una cartella…" e "Nuovo spettacolo" **di pari peso** (superficie chiara, bordo marcato, testo in grassetto); gruppi **"In produzione"** (punto verde) e **"Altri spettacoli"** separati da un filetto; schede **tutte della stessa altezza**; trascinando una scheda compare un segno a sinistra della scheda di arrivo. Le **copie** stanno dentro la scheda dell'originale come elenco puntato.
- **Schermata Progetto**: copertina grande con i comandi (Nome, Cambia copertina, Crea copia, **In produzione** verde pieno quando attivo, Mostra nella cartella); fasi + "Tutto pronto per la serata" + "Apri tutto" su una riga; una colonna per app (filetto superiore nel colore dell'app). Ogni documento ha solo il selettore di fase; in fase Spettacolo un filetto verde a sinistra; si apre con doppio clic senza scritte di istruzione; documento mancante con nome file ed estensione in ambra e pulsante "Rimuovi"; sotto i copioni Bardo elenco comprimibile delle copie esportate con l'etichetta del tipo (PDF, DOCX) nel colore dell'app.
- **Pagina "Theatre Suite"** (0.3.2): stile da "negozio" sobrio. **Testata = Theatre Suite stesso** (marchio grande, leggera sfumatura indaco/rame sullo sfondo, versione, stato, "Aggiorna alla x", "Controlla ora", "Tutte le versioni", "Tieni questa versione"). Sotto, **le app in griglia 2 × 2** di schede alte uguali: filetto superiore sfumato nel colore dell'app, icona grande, nome, ruolo nel colore dell'app, frase descrittiva, versione installata in evidenza, azione principale (Installa / Aggiorna alla x / Apri, o barra di avanzamento), "Tutte le versioni" (la versione installata segnata in verde) e l'interruttore "Tieni questa versione". App in arrivo con fondo più spento. **In fondo un solo testo senza riquadri** (frase offline, crediti, link "Scrivici"). Niente percorsi di file.
- **Verde** nel launcher solo per "pronto / in fase Spettacolo / in produzione / installata" (stesso significato del resto della suite: in onda/ok).
- **Copertina**: "immagine, altrimenti colore" (vedi 07). **Nelle app**: barra del titolo con fascia e sfumatura del colore dello spettacolo, **senza miniatura**; l'accento dell'app resta il colore principale. Regole in "Barra del titolo". Il colore è lo stesso del launcher (`showColor` in `packages/core`). L'app riconosce lo spettacolo se accanto al suo file c'è `progetto.theatre`.
- **Icona di ogni app nel launcher = icona dell'app** (stessa geometria, stesso colore).

## Quando consultarmi
Le scelte grafiche ordinarie le prende Claude, in coerenza con la suite. Le **modifiche importanti** (palette, stile generale, struttura delle schermate, nuove modalità) e le richieste esplicite si presentano prima con un'anteprima visiva, possibilmente con alcune alternative.

## Decisioni approvate
Approvate il 4 novembre 2026 con Diaframma (anteprima: https://claude.ai/artifact/K8sSnbRFwLUPSSosVmCh71).

### Palette "Grafite" (base comune a tutta la suite)
| Ruolo | Scuro | Chiaro |
|---|---|---|
| Sfondo finestra | #0E0F12 | #ECEEF2 |
| Barre | #131418 | #F7F8FA |
| Superfici | #18191E · #202228 · #2A2D35 | #FFFFFF · #F2F3F6 · #E5E7EC |
| Bordi | #272A31 · #383C46 | #DCDFE5 · #C3C8D1 |
| Testo | #ECEDF0 · #A7AAB3 · #878B95 | #14151A · #4A4E58 · #5F6470 |

Angoli arrotondati: 5 / 7 / 10 / 14 px.

### Linguaggio dei colori (uguale in tutte le app)
Il colore compare solo quando significa qualcosa; tutto il resto è neutro.
- **Verde** (#34D17B; chiaro #0B7D3E testo, #22B866 riempimento): in onda, GO, "lo sentono tutti".
- **Ambra** (#FFB224; chiaro #955700 testo): attenzione, pronto a partire.
- **Rosso** (#FF5F5F; chiaro #C42B2B): stop, elimina.
- **Blu** (#4FA8FF; chiaro #1463C4): preascolto, "lo senti solo tu".
- **Accento dell'app**: ciò che hai scelto o stai modificando; distingue un'app dalle altre.

Fondi tenui per celle e pillole (nati con Cantinella; variabili `--go-bg`, `--sb-bg`, `--sb-row`, `--stop-bg`, `--pre-bg`, `--neutral-bg` in `theme.css`): tema chiaro verde #DDF3E6, ambra #FFF0D1 (righe "da controllare" #FFF8E8), rosso #FBE1E1, blu #E7F0FB, neutro #F2F3F6. Tema scuro: verde #15301F, ambra #3A2C0D (righe #2E240F), rosso #3A1A1C, blu #172638, neutro #2A2D35.

**Eccezione: i colori della luce (Granvelo, approvata il 15/11/2026, confermata dal design del 16/11).** In Granvelo i fader di rosso, verde, blu, ambra, bianco e UV mostrano il **colore della luce** che comandano. Non è uno stato: compare solo come **campione** (striscia o pallino nell'etichetta del canale) e come riempimento del fader, e come **colore della lente nel simbolo della luce**, **mai su pulsanti, pillole o riquadri di stato**, sempre insieme al nome del canale. Così verde, ambra, rosso e blu conservano il loro significato nel resto dell'interfaccia. Colori usati nel design: rosso #F2484B, verde #3DD66A, blu #3D7BFF, bianco #F4F1EA, UV #9B5CFF, alogeno #FFD9A0, pan/tilt grigio #6B6F7A.

### Accenti delle app
| App | Colore | Scuro | Chiaro | Logo | Stato |
|---|---|---|---|---|---|
| Diaframma | Indaco | #8E80FF | #5442E0 | #6B5BEF | definitivo, realizzato |
| Bardo | **Rame** | #F2955E | #A9501F | #C8642C | definitivo, realizzato (anche nel launcher dal 12/11) |
| Cantinella | **Ardesia** | #A9B6CF | #3F4C66 | #55627E | definitivo, realizzato (14/11, Cantinella 0.1.0 e launcher 0.3.1) |
| Granvelo (luci) | **Gelatina** (magenta) | #F06FCF | #A3218A | #C2349F | **definitivo (16/11/2026)**, da realizzare nella fase 0 (già nell'icona del launcher) |
Il **ciclamino** (#F07CC4 / #B02A7F), proposto all'inizio per Bardo e di nuovo per Cantinella, **non è stato adottato** per quelle due app; nemmeno la **prugna** (#C79BF2 / #7A3FA8, troppo vicina all'indaco). La **sabbia** provvisoria di "Produzione" è stata **scartata**: accanto all'ambra del "forse", presente in quasi ogni schermata di Cantinella, si confondeva. Il rame resta ben distinto dall'ambra di "attenzione" (più rosso, meno giallo), ma va evitato nelle app dove l'ambra compare spesso accanto all'accento. Nelle pagine di Bardo i segni disegnati sulla carta (mai stampati) usano `--paper-accent` #A9501F su carta bianca anche in tema scuro.

**Granvelo · Gelatina** (scelta il 16/11/2026 fra Petrolio, Gelatina e Fosforo): il nome richiama le gelatine colorate dei fari. È lontana da verde, ambra, rosso e blu (la selezione di una luce non si scambia per uno stato) e nessun fader ne ha il colore. Scartati: **Petrolio** (#3FC1C9 / #0F7F87, vicino al blu del Blind e al ciano dei LED, che fa anche da colore di scena) e **Fosforo** (#C2E05B / #5A7310, vicino al verde "in onda", il rischio maggiore nello Show). Valori: `--accent` scuro #F06FCF, chiaro #A3218A; `--accent-soft` scuro #33182D, `--accent-line` scuro #6E2E5E (chiaro da derivare: soft circa #F8E3F2, line circa #E0A9CE); `--accent-ink` (testo sull'accento pieno) **#0E0F12** in scuro, bianco in chiaro. Tema predefinito: **scuro**. Attenzione: il magenta è parente del ciclamino non adottato altrove, ma accanto al rame di Bardo e all'ardesia di Cantinella si riconosce bene; nel launcher l'icona di Granvelo si distingue per colore e per forma.

**Cantinella · Ardesia**: quasi neutro, così verde, ambra e rosso (sì / forse / no, semafori, pagato) risaltano al massimo. `--accent-soft` chiaro #E4E8EF, scuro #232833; `--accent-ink` bianco in chiaro, #14151A in scuro (l'ardesia scura è chiara). Due attenzioni: (1) è un grigio-blu, quindi accanto al **blu** "informativo/confermato" va sempre la parola o il simbolo, mai solo il colore; (2) è vicino al grigio del launcher: si riconosce soprattutto dall'icona. Tema predefinito: **chiaro** (app da ufficio/produzione).

### Caratteri
**Geist** per l'interfaccia e **Geist Mono** per numeri, tempi e codici, inclusi nell'app (funzionano offline). Eccezione: il **testo del copione** in Bardo usa i caratteri tipografici del modello scelto (Source Serif 4, Courier Prime…), non quelli dell'interfaccia.

### Pulsanti e simboli
Ogni pulsante ha simbolo + etichetta (nella barra del titolo, per le azioni a destra, basta il simbolo con il tooltip). Simboli lineari con tratto da 2 px. **Eccezione (Granvelo)**: i comandi di sicurezza dello Show (Blackout, Fade to black, Emergenza) sono **scritte con il tasto** (`Kbd`) nella barra in basso, senza simbolo né riquadro.

### Icone delle app
Tessera chiara (#F6F6F8, angoli arrotondati, bordo #E1E2E7); dentro, segni a tratto sottile con estremità arrotondate: l'accento dell'app più un inchiostro scuro (#1B1C21). Sotto i 32 px il tratto si ingrossa. Ogni app ha `tools/make_icons.mjs` che genera PNG e ICO dalla geometria scritta qui.

**Diaframma (definitiva):** due forme d'onda a barre verticali, indaco (#6B5BEF) sopra e inchiostro sotto, con profili diversi. Geometria su riquadro 100×100, tratto 3 (3,4 a 32–64 px, 4,2 sotto i 24 px):
- sopra: `M20 34V38M25 32V40M30 29V43M35 31V41M40 26V46M45 23V49M50 27V45M55 30V42M60 28V44M65 31V41M70 33V39M75 32V40M80 34V38`
- sotto: `M20 64V68M25 63V69M30 61V71M35 62V70M40 60V72M45 58V74M50 60V72M55 56V76M60 54V78M65 59V73M70 61V71M75 63V69M80 64V68`

**Bardo (definitiva, "A · Battute"):** tre nomi corti di personaggio in rame (#C8642C) a sinistra e, accanto, le righe delle battute in inchiostro. Riquadro 100×100, tratto 3,2:
- rame: `M18 28H31M18 50H29M18 72H33`
- inchiostro: `M41 28H82M41 36H66M41 50H82M41 58H74M41 72H78`
(Il launcher usa esattamente questa geometria in `apps/launcher/src/lib/apps.ts`.)

**Cantinella (definitiva, "I · Telaio", 13/11/2026; realizzata il 14/11):** la cantinella è il listello di legno con cui si costruiscono i telai delle scene: un telaio in inchiostro con traversa centrale e le due diagonali di rinforzo in ardesia (#55627E). Riquadro 100×100, tratto 3,2 (3,6 fino a 64 px, 5,5 a 28–32 px, 7 fino a 24 px; nella barra del titolo a 20 px tratto 7), estremità e giunzioni arrotondate:
- inchiostro: `M30 16H70V84H30ZM30 50H70`
- ardesia: `M35 45L65 21M35 79L65 55`
Alternative scartate: "II · Piano" (listelli come barre, troppo simile alle righe di Bardo) e "III · Griglia" (racconta solo le Prove). **Prova a 16–24 px fatta il 14/11**: le diagonali si distinguono dal telaio, quindi il logo resta #55627E (lo schiarimento a #6B7A99 non serve).

**Granvelo (definitiva, "Banco", 16/11/2026; da realizzare nella fase 0):** il banco luci che l'app sostituisce: tre fader verticali in inchiostro con tre cursori orizzontali in magenta (#C2349F) a altezze diverse. Riquadro 100×100, **tratto spesso** (come le barre di Diaframma), estremità arrotondate:
- inchiostro (#1B1C21): `M28 18V82M50 18V82M72 18V82`
- magenta: `M20 62H36M42 34H58M64 50H80`
- spessore: **6** (6,4 a 64 px, 8,5 a 32 px, 9,5 a 24 px, 11 a 16–20 px; nella barra del titolo a 20 px tratto 11).
Alternative scartate: "Fascio" (un faro con fascio e pozza di luce: si legge come "luce" anche da chi non è del mestiere, ma Banco è più nitida a 16 px) e "Palco" (palco in prospettiva con luce: troppi dettagli sotto i 24 px). Spessori provati: sottile (3,2), medio (4,6), spesso (6): scelto lo spesso.

## Granvelo (stato della 0.6.0)
Componenti e modelli nati con Granvelo. I colori vengono sempre da `packages/ui/src/theme.css` più l'accento **Gelatina**; i componenti specifici stanno in `apps/granvelo/src` finché un'altra app non ne ha bisogno (allora passano a `packages/ui`).
- **Cursore di Granvelo** (`modes/desk/Fader.tsx`; rispecchia `VFader` di `packages/ui`, che non ha colore di riempimento né digitazione): rotaia stretta con **riempimento nel colore della luce o del canale** (rosso, verde, blu, bianco, ambra, UV; l'intensità di un alogeno nel suo color paglia; verde non c'entra con "in onda": è il verde del canale), campione colorato accanto al nome del canale, **valore sopra** in Geist Mono (0–255 o %, dalle Impostazioni) e **numero DMX sotto**. Il valore si digita con un clic; rotella sul cursore, Maiusc = passi di 1, doppio clic = valore di riposo (0; i gruppi e il Grand Master tornano a 255). `role="slider"`, frecce da tastiera. I nomi dei gruppi e "Grand Master" **vanno a capo su due righe** in un cursore largo 64 px, mai tagliati con "…".
- **Pillola dell'uscita DMX** (`common/OutputChip.tsx`, in alto a sinistra, sempre visibile): punto di stato + parola. Grigio = non connessa; verde = "DMX USB Pro · connesso"; grigio con "Uscita simulata"; **ambra = "Cavo scollegato · riprovo…"**; il clic apre il pannello (connetti, disconnetti, aggiornamenti al secondo, impostazioni uscita).
- **Fascia rossa "cavo scollegato"**: sotto la barra superiore, in tutte le modalità, `role="alert"`: "Cavo USB-DMX scollegato. Granvelo continua a riprovare; appena torna, le luci ricevono subito lo stato attuale." Rosso perché le luci non obbediscono più.
- **Fascia blu Blind**: "BLIND · stai modificando la memoria N. Il palco non cambia: resta in scena la M" con "Esci da Blind · Esc"; bordo blu da 3 px attorno all'anteprima, etichetta "BLIND · la vedi solo tu" e riquadro verde "In scena". Blu = "lo vedi solo tu", sempre con la parola.
- **Fasce Blackout / Fade to black / Emergenza**: ambra per Blackout e Fade to black ("Riaccendi le luci"), rossa per l'Emergenza ("Torna allo spettacolo").
- **Nastro dello Show** (`modes/show/Nastro.tsx`): riquadri a larghezza fissa nei loro posti — **IN ONDA** (bordo verde 2 px, anteprima, numero, nome, "da m:ss"), **riquadro della transizione** (tratteggiato; pieno e verde mentre corre, ambra "IN PAUSA · P per riprendere"; 196 px, testo "Crossfade 3 s" o "Salita 5 s · discesa 3 s", barra, stato, opzioni, matita), **PRONTA** (bordo ambra 2 px, "al prossimo GO"), poi le successive più piccole e sfumate a destra. Durante una transizione ogni riquadro scorre dal vecchio al nuovo posto nel tempo della transizione (Pausa lo ferma); il riquadro di transizione che si apre o si chiude **si vede solo quando è quasi aperto**, così non resta mai mezzo schiacciato con il testo tagliato.
- **Comandi di testo in fondo** (Show): "Memoria N di M", "Serata h:mm:ss", poi **Blackout `B`**, **Fade to black · 5 s `F`**, **Emergenza `E E`** (rossa), a sola scritta con il tasto, senza riquadro né simbolo.
- **Selettore del banco** No · Mini · Compatto · Esteso su una riga propria sopra i cursori.
- **Stampe** (`apps/granvelo/src/print`): sempre **nero su bianco** (carta), anche con il tema scuro: pianta A4 orizzontale, elenco A4 verticale; i simboli delle luci sono gli stessi dello schermo con tratto scuro (`--gv-symbol-stroke` #2A2A2A, lente bianca). Anteprima in una finestra con carta scalata.
- **Palco sempre scuro** a schermo, anche con il tema chiaro (le pozze di luce si leggono solo su fondo scuro); la selezione ha il riquadro in accento; il riquadro di selezione a trascinamento (Maiusc + trascina) è tratteggiato nell'accento.
- **Icone nuove in `packages/ui/src/icons.tsx`** (fase 0): `blackout`, `ftb`, `emergency`, `bench` (Banco), `stage` (Allestimento), `plug` (connessione), più `GRANVELO_LOGO` ("Banco"). `eye` (Blind), `curtain` (Show), `printer` (Stampa) esistevano già.
- **Ambra della luce #FF8A1F**: è **solo un campione** (il colore del canale ambra e della luce che fa); non è il colore di attenzione della suite (#FFB224), che resta quello degli stati "pronta", "modificata, non salvata" e "conflitto". Mai usare #FF8A1F per uno stato.
