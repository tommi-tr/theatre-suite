# 10 — Granvelo (luci)

Stato e prossimi passi: `00_indice_e_stato.md`. Specifica approvata dall'utente il 15/11/2026 (chat di definizione); **design approvato il 16/11/2026 (fase D)**. Nessun codice ancora. Identificativo previsto `it.theatresuite.granvelo`, file `.granvelo`, ramo `granvelo-dev`, porta di sviluppo **1423**. Anteprima del design (canvas, 3 pagine): https://claude.ai/artifact/SKcCiWaAjvocz6wt9EEmiN

## Cos'è
Software che **sostituisce il banco luci**: il computer comanda le luci tramite un **cavo USB-DMX**. Disegna il palco in 3D con le luci, le comanda con un banco virtuale e manda in scena le memorie durante lo spettacolo.
- **Utenti**: soprattutto **compagnie amatoriali**. Deve essere chiarissima per chi non è un tecnico: parole semplici, nessun gergo da banco professionale non spiegato.
- **Piattaforme**: **solo Windows 10/11** per ora, come tutta la suite. **macOS è rimandato** (deciso il 15/11/2026, sera): si scrive il codice senza precluderlo (la porta seriale e il 3D sono già multipiattaforma), ma non si costruiscono né si provano pacchetti macOS e non serve un workflow CI macOS.
- **Un universo DMX** (512 canali) basta. Il formato prevede comunque il numero di universo (sempre 1), per non chiudere la strada a dopo.
- Tema predefinito **scuro** (app di scena). Lingua italiana, interfaccia predisposta per l'inglese.
- **Da sola**: per ora **nessun collegamento** con Diaframma, Bardo e Cantinella, e quindi niente "Torna al launcher" (vedi 02) finché non sarà nel launcher. L'inserimento nel launcher (aprire, creare, installare) si decide più avanti con l'utente. Nella pagina Theatre Suite del launcher compare già come segnaposto "Luci (In arrivo)".

## Design approvato (fase D, 16/11/2026)
Dettagli visivi e componenti in `02_design.md`; qui ciò che serve a costruire le schermate.
- **Accento: Gelatina (magenta)**. Scuro #F06FCF, chiaro #A3218A, logo #C2349F; fondo tenue scuro #33182D, linea #6E2E5E; testo sull'accento pieno #0E0F12. Scartati Petrolio (troppo vicino al blu del Blind) e Fosforo (troppo vicino al verde "in onda").
- **Icona: "Banco"**: tre fader verticali in inchiostro (#1B1C21) con tre cursori orizzontali nell'accento (#C2349F), a altezze diverse, su tessera chiara. **Tratto spesso** (peso delle barre di Diaframma). Riquadro 100×100, tessera `#F6F6F8` angoli 22, bordo `#E1E2E7`; tratti con estremità arrotondate:
  - inchiostro: `M28 18V82M50 18V82M72 18V82`
  - accento: `M20 62H36M42 34H58M64 50H80`
  - spessore del tratto: **6** (6,4 a 64 px; 8,5 a 32 px; 9,5 a 24 px; 11 a 16–20 px, quindi anche nella barra del titolo). `tools/make_icons.mjs` genera PNG e ICO da questa geometria. Alternative scartate: "Fascio" (faro con fascio) e "Palco" (prospettiva con luce).
- **Struttura delle finestre** (1366 × 768 come riferimento): barra del titolo con logo e nome del file, versione a destra; barra superiore con a sinistra lo stato dell'uscita DMX ("Connetti" / "DMX USB Pro · connesso" / "Uscita simulata"), **selettore Allestimento · Banco · Show al centro**, a destra i comandi della modalità, Annulla/Ripeti e Impostazioni; barra di stato in basso.
- **Pulsante Blind**: a destra nella barra superiore, **in Banco e in Show accanto a Lock** (in Show prima di Lock), con la scorciatoia **Ctrl B**. Si attiva sulla memoria selezionata nell'elenco; se quella memoria è già in scena l'app chiede di sceglierne un'altra. Attivo: il pulsante diventa blu, compare una fascia blu "BLIND · Stai modificando la memoria N. Il palco non cambia: resta in scena la M" con "Esci da Blind · Esc"; l'anteprima ha il bordo blu e la scritta "la vedi solo tu", con a lato un riquadro verde di ciò che è davvero sul palco; la memoria in modifica è blu nell'elenco. Con Lock attivo Blind è bloccato insieme al resto.
- **Show: interfaccia "Nastro"** (come nella specifica): a sinistra il riquadro verde **IN ONDA** (anteprima, numero, nome, da quanto tempo), poi il **riquadro della transizione** ("Crossfade 4 s" con barra che si riempie e una riga sotto: salita/discesa, ritardo, teste mobili al buio, parte da sola), poi il riquadro ambra **PRONTA** ("al prossimo GO"), poi le successive più piccole e sfumate verso destra. Sotto: **GO** grande in verde, **Indietro**, **Pause** e il promemoria dei tasti (`Spazio` GO · `Backspace` Indietro · `P` Pause). Sotto ancora il **Banco** con il suo selettore **No · Mini · Compatto · Esteso su una riga propria** (il selettore non deve mai sovrapporsi ai fader: l'Esteso sta sotto, a tutta larghezza). Barra in basso con "Memoria N di M", durata della serata e, a destra, **tre comandi a sola scritta con il tasto**: **Blackout `B`**, **Fade to black `F`** (con il tempo, es. 5 s), **Emergenza `E E`** (rossa, "premi due volte"). Non sono pulsanti grandi e non tolgono spazio alla schermata. Scartate: B "Palco grande + scaletta" e C "Scaletta a tutta pagina" (dell'ultima vale l'idea di tenere questi tre comandi sempre nello stesso punto).
- **Banco**: sopra la **vista frontale** del palco (luce selezionata cerchiata nell'accento; clic per trovarla nel banco, Maiusc+clic per aggiungerne); sotto una **scheda per luce** con i fader nei colori della luce (campione + nome del canale + numero DMX) e, a destra, i **gruppi** con il **Grand Master**; colonna destra con la memoria in scena ("modificata, non salvata" in ambra + Salva / Salva come nuova / Ripristina), **selettore colore** e **elenco delle memorie** (numero, miniatura, nome; in scena in verde, in Blind in blu).
- **Allestimento**: a sinistra l'**elenco delle luci** per posizione (In sala, 1ª americana, 2ª americana, A terra) con numero, **simbolo del tipo**, nome, tipo e indirizzo (in ambra se in conflitto, grigio e sbiadito se "non usata"); al centro il **palco 3D** con selettore Prospettiva / Pianta / Frontale e strumenti Sposta · Orienta · Numera a clic · Scenografia; a destra le **proprietà** della luce (tipo, indirizzo e canali occupati, posizione Americana / Fluttuante / A terra con X, Y, Z, fascio e puntamento, ordine e funzione dei canali con "Applica a tutte le luci di questo tipo", "Non usata in questa produzione"); in basso la barra di stato con luci, canali usati su 512 e l'avviso di conflitto.

## Simboli delle luci (Allestimento)
Disegni piatti a tratto (non 3D), uguali nel palco, nella pianta, nell'elenco e nelle stampe per gli elettricisti. Sempre rivolti verso dove puntano (appesi capovolti sotto le americane). Le luci a colori (**PAR LED, testa mobile, barra LED**) mostrano nella lente il **colore che stanno facendo**. Quattro stati: normale (tratto #A7AAB3), **selezionata** (riquadro arrotondato nell'accento intorno al simbolo + etichetta con numero, nome e indirizzo), **conflitto di indirizzo** (tratto ambra), **non usata** (tratteggiata, sbiadita). Percorsi su riquadro 24×24, tratto 1,6, estremità arrotondate, fondo #202228:
| Tipo | Simbolo | Percorso |
|---|---|---|
| PAR LED (RGB, RGBW, 6 e 7 canali) | tondo con la lente | `M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0` (+ cerchio r 3,2 col colore) |
| Alogeno / PC (1 canale) | rettangolo con le quattro bandiere | `M8 8h8v8H8zM8 8L5 4h14l-3 4M16 8l4-3v14l-4-3M16 16l3 4H5l3-4M8 16l-4 3V5l4 3` |
| Sagomatore (1 canale) | corpo lungo con la lente | `M3 9h12v6H3zM15 8l5-2v12l-5-2M7 15v3` |
| Testa mobile wash | cilindro sulla forcella con la base | `M5 18h14v3H5zM7 18V9M17 18V9M7 11h2M15 11h2M11 5h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z` |
| Testa mobile spot | come la wash + punto della lente stretta | percorso della wash + `M12 9.5a1.6 1.6 0 1 0 0.01 0` |
| Barra LED | barra con i punti delle celle | `M2 9h20v6H2zM6 12h.01M10 12h.01M14 12h.01M18 12h.01` |
| Strobo | scatola con il lampo | `M3 7h18v10H3zM13 8l-3 4h4l-3 4` |
| Macchina del fumo | scatola con lo sbuffo | `M2 9h10v7H2zM12 12h2M16 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M18.5 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 15a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0` |
I simboli vivono in `packages/ui/src/icons.tsx` (o in un modulo dell'app, se restano solo di Granvelo); i tipi nuovi si aggiungono con un simbolo proprio. Le scorciatoie (B, F, E E, Ctrl B, Spazio, Backspace, P, Ctrl L) vanno controllate contro i conflitti nella fase 4.

## Hardware
- L'utente ha un **cavo USB-DMX di tipo sconosciuto**: va identificato nella fase 1 (l'app elenca i dispositivi seriali con nome e produttore).
- Si supportano entrambe le famiglie: **"Pro"** (Enttec DMX USB Pro, DMXking e cloni: protocollo con messaggi, molto affidabile) e **"Open DMX"** (FTDI senza processore: il computer genera break e tempi). Riconoscimento automatico, con scelta manuale nelle Impostazioni.
- Il **banco fisico non si usa** (non ha ingresso USB). Art-Net/sACN: idea per il futuro.
- Nessun driver installato dall'app (arrivano da Windows Update); se servisse un driver FTDI si spiega e si chiede (vedi 03).

## Tre modalità (selettore in alto al centro, come in Diaframma)
**Allestimento · Banco · Show**. Un solo documento `.granvelo` per spettacolo con palco, americane, luci, scenografia, gruppi, memorie e sequenza.

### Allestimento
- **Spazio 3D navigabile.** Il palco è un parallelepipedo con dimensioni impostabili all'inizio e modificabili dopo. Il piano è ben visibile, il resto del volume è disegnato con linee sottili (le americane del perimetro). **Niente zone di platea o quinte disegnate e niente torri** (decisione dell'utente): le luci in sala o tra le quinte sono semplicemente "fluttuanti" fuori dal volume.
- **Americane automatiche**: quando si lascia una luce in alto a una profondità nuova nasce un'americana, una linea orizzontale con calamita, chiamata "1ª americana", "2ª americana"… Si può rinominare e spostare anche con i numeri.
- **Posizioni delle luci**: sulle americane (calamita), fluttuanti oppure a terra (sul palco o fuori). Si trascinano col mouse. Ogni valore è impostabile anche con le coordinate numeriche. Assi: X da sinistra a destra **vista dalla platea**, Y la profondità dal boccascena (verso il fondo positiva), Z l'altezza dal piano del palco; in metri, con le etichette scritte.
- **Tipi di luce** da un elenco, **ognuno con il suo simbolo** (vedi sopra): alogeno/dimmer (1 canale), PAR LED RGB (3), PAR LED a 4, 6 e 7 canali, barra LED, testa mobile wash e spot, sagomatore, strobo, macchina del fumo… ognuno con i suoi canali predefiniti. **L'ordine e la funzione di ogni canale si cambiano per luce** (il primo può essere Main, rosso, tilt…), con un comando "applica a tutte le luci di questo tipo". La funzione del canale guida l'anteprima e il colore del fader. **Non ci sono** libreria personale, modalità DMX multiple, valori di riposo né intervalli (proposti e rifiutati il 15/11; si possono riproporre se servono).
- **Fascio e orientamento** anche per le luci fisse: larghezza del fascio (gradi) e puntamento approssimativo. Valori predefiniti: in sala puntano al proscenio (distribuite, non tutte al centro), sopra il palco a pioggia, i tagli orizzontali, quelle sul fondo in controluce. Si possono selezionare una o più luci e orientarle con un puntatore apposito oppure con i numeri.
- **Indirizzi DMX** come si impostano sulle luci (il tastierino dietro i PAR): manuale per luce o per gruppo, oppure **numerazione automatica** cliccando le luci in ordine (indirizzi consecutivi secondo il numero di canali). Se una luce si toglie gli indirizzi **non** si ricalcolano (predefinito).
- **Mappa degli indirizzi**: griglia dei 512 canali con quelli occupati, i conflitti in ambra.
- **Luce "non usata in questa produzione"**: resta nel disegno in grigio e i suoi indirizzi restano fermi.
- **Stampe per gli elettricisti** (PDF): pianta delle luci vista dall'alto ed elenco con numero, tipo, canali, indirizzo e posizione.
- **Scenografia**: parallelepipedo, cono, sfera, rettangolo piano, cilindro; si inclinano, ruotano e spostano, con un colore. Entrano ed escono di scena e **si salvano con le memorie**.

### Banco
- **Vista frontale** del palco (pulsante per tornarci). Il banco virtuale ha i canali **raggruppati per luce** (es. i primi tre canali sono i PAR in sala). Cliccando una o più luci il banco evidenzia i loro canali.
- **Fader** come in Diaframma: rotella del mouse passandoci sopra (Maiusc = passi fini), valore digitato cliccandolo. Ogni fader ha un'etichetta con la funzione. Il **colore della luce** (rosso, verde, blu, ambra, UV…) compare come **campione** nell'etichetta e come riempimento del fader, **mai sui pulsanti** (eccezione annotata in 02). Riferimento visivo: le schede faro di LightStage.
- Intensità in **0–255 o in %**, a scelta nelle Impostazioni.
- **Selettore colore** per le luci a colori: imposta da solo R, G, B (e W, A se ci sono).
- **Gruppi** (es. "Tagli SX") con un fader che scala l'intensità in proporzione, e il **Grand Master**.
- **Memorie** con numero (intero, scelto dall'utente; **niente decimali**) ed etichetta. Ogni memoria salva **lo stato completo** di tutte le luci e la scenografia in scena. Non si salvano da sole: "Salva" o "Salva come nuova memoria". **Stato in chiaro**: "modificata, non salvata" in ambra, con "Ripristina". Annulla/Ripeti.
- **Memorie legate agli indirizzi DMX** (predefinito) **oppure alle luci** (impostazione). Legate alle luci: cambiare un indirizzo non rovina le memorie.
- **Blind** (pulsante e Ctrl B, vedi "Design approvato"): si modifica una memoria che non è in scena guardando solo l'anteprima, senza toccare il palco. Usa il **blu** ("lo vedi solo tu"), sempre con la scritta BLIND.
- Si può usare **anche come semplice banco**, senza memorie.

### Show
- Ordine delle memorie (anche da Banco) e **transizioni**: crossfade predefinito 3 s, sempre modificabile digitando il valore. Tempi separati di salita e discesa, ritardo, **"parte da sola"** (alla fine parte la successiva), teste mobili che **si spostano al buio**.
- **Memoria in onda a sinistra in un riquadro verde** con l'anteprima. La successiva è in ambra ("pronta"). Al GO (barra spaziatrice) la miniatura scorre a sinistra ed entra la successiva, **nel tempo della transizione**. Tra un riquadro e l'altro c'è il **riquadro della transizione** ("Crossfade 5 s") che si riempie mentre avanza. (Interfaccia scelta: "Nastro".)
- **Indietro** e **Pausa** della transizione.
- **Blackout** (`B`) reversibile (la seconda pressione riporta lo stato di prima) e **FTB** (`F`) con un tempo. Sono **comandi a sola scritta nella barra in basso**, non pulsanti grandi.
- **Emergenza** (`E E`, scritta rossa nella barra in basso): tutte le luci bianche a piena intensità (o una memoria scelta nelle Impostazioni). La prima pressione la prepara, la seconda entro 3 s la attiva.
- **Lock** come in Diaframma: blocca tutto tranne GO, Indietro, Pausa, Blackout, FTB ed Emergenza (si sblocca tenendo premuto o con Ctrl+L). Blocca anche Blind.
- Banco visibile o no; se visibile **Esteso** / **Compatto** (un'intensità per luce) / **Mini** (solo gruppi); il selettore sta su una riga propria sopra il banco.
- **Controllo luci**: accende una luce alla volta, avanti e indietro, e si segnano quelle che non vanno.

## Anteprima e computer vecchi
Impostazione **Dettaglio dell'anteprima**:
- **Essenziale**: pozze di luce come **ellissi piene**, senza fasci né ombre.
- **Media**: pozze sfumate e fasci semitrasparenti.
- **Alta**: ombre della scenografia, fasci nel fumo, alogeni più caldi quando si abbassano.
- **Automatica**: misura la fluidità e propone il livello.

Inoltre: l'anteprima si ridisegna **solo quando cambia qualcosa**; le miniature delle memorie si calcolano una volta e si conservano; se manca la grafica 3D (WebGL) l'app passa da sola a due **viste 2D** (pianta e frontale).

## Affidabilità
- **Motore DMX nativo in Rust**, in un proprio thread, separato dall'interfaccia (come l'audio di Diaframma): circa 40 aggiornamenti al secondo, crossfade calcolati dal motore. Se l'interfaccia si blocca, la luce resta.
- **All'avvio non manda nulla finché non si preme "Connetti".**
- Se il cavo si stacca: avviso rosso, ricollegamento automatico e rinvio dello stato.
- Salvataggio automatico, recupero dopo un crash, versioni del file (come Diaframma: `Spettacolo.versions/`).
- **Test di affidabilità**: la sequenza delle memorie fatta girare senza uscita, con un rapporto.

## Impostazioni (categorie a sinistra)
Generali (lingua, tema, 0–255/%) · Uscita DMX (dispositivo, tipo Pro/Open, prova) · Anteprima (dettaglio) · Memorie (legate a indirizzi/luci, crossfade predefinito, memoria di emergenza) · Test · Informazioni (versione).

## Da LightStage (riferimento parziale dell'utente)
Prese come ispirazione: le schede faro con fader colorati, il selettore colore, la dissolvenza per memoria, le teste che si spostano al buio, l'FTB con il tempo, le scorciatoie, la griglia con le miniature. **Da confermare con l'utente** (proposte non ancora approvate né rifiutate): "Punta qui" (clic sul palco per puntare le luci selezionate), "Trova" (la luce selezionata si accende bianca per riconoscerla), **taratura delle teste mobili sui quattro angoli**. Escluse: salvataggio online, luci a tempo di musica, 100 spazi fissi, copione PDF.

## Tecnologia (da confermare nella fase 0, con le versioni verificate)
Tauri 2 + React + TypeScript, `packages/ui` e `packages/core` come le altre app. 3D con **three.js** (WebGL). Motore DMX in Rust con porta seriale (crate `serialport`; su Linux serve `libudev-dev` per compilare nelle sessioni di Claude). Stato in zustand. Test: vitest (modello, crossfade, indirizzi), `cargo test` (motore DMX con un dispositivo finto che registra i frame). Anteprima in browser `/?demo` con uno spettacolo di prova (*La locandiera*, come nel design: 15 luci, 9 memorie) e uscita DMX simulata. CI: **solo Windows** per ora.

## Fasi di sviluppo
| Fase | Contenuto | Versione |
|---|---|---|
| D | **Design**: **fatta il 16/11/2026** (accento Gelatina, icona Banco, simboli delle luci, Show "Nastro", Blind) | — |
| 0 | Scheletro `apps/granvelo`, modello e file `.granvelo` formato 1, Impostazioni, accento Gelatina e icona in `packages/ui` e nel launcher (segnaposto "Luci" da petrolio a magenta), CI **Windows** (installer `Granvelo_<v>_x64-setup.exe`, workflow come le altre app) | 0.1.0 |
| 1 | **Motore DMX** (Pro e Open DMX, riconoscimento, Connetti, ricollegamento, simulatore), identificazione del cavo dell'utente, elenco luci con canali e indirizzi, mappa degli indirizzi, Controllo luci. Prima il rischio hardware | 0.2.0 |
| 2 | **Allestimento 3D**: palco, americane automatiche, trascinamento, coordinate, simboli per tipo, fascio e orientamento, numerazione a clic, scenografia, dettaglio dell'anteprima (Essenziale/Media, ripiego 2D) | 0.3.0 |
| 3 | **Banco**: fader per luce, colore, gruppi e Grand Master, memorie, stato, Blind | 0.4.0 |
| 4 | **Show**: sequenza, transizioni, GO e scorrimento, Lock, Blackout, FTB, Emergenza, banco Esteso/Compatto/Mini, test di affidabilità | 0.5.0 |
| 5 | Stampe per elettricisti, anteprima Alta e Automatica, rifiniture e prove su computer vecchi | 0.6.0 |
L'ordine non è vincolante.

## Come si lavora: direttore dei lavori Fable
Le chat di Granvelo sono condotte da **Claude Fable** come **direttore dei lavori**. Fable non scrive il grosso del codice: pianifica, assegna e controlla, e affida il lavoro ad altri modelli con lo strumento degli agenti (`Agent`, parametro `model`). (La fase D, che non produce codice, è stata fatta in una chat con un altro modello: va bene, non c'era nulla da affidare.)
1. **Apertura**: l'utente apre una nuova chat nel progetto con il modello Fable e scrive "**Granvelo, fase N**". Fable legge 00 e questo documento (più 02 se si tocca la grafica), clona con `add_repo` (accesso push), crea o riprende il ramo `granvelo-dev` partendo da `cantinella-dev` (o da `main` dopo le unioni).
2. **Piano**: Fable propone all'utente in poche righe cosa si farà nella fase e come la divide. Per le schermate nuove importanti mostra un'anteprima e aspetta l'ok. Verifica le versioni delle librerie e le comunica.
3. **Assegnazione** (ogni incarico è autosufficiente: obiettivo, file da toccare, criteri di accettazione, comandi di verifica):
   - **Opus** (`model: "opus"`): le parti difficili o rischiose, cioè motore DMX Rust, protocolli seriali, crossfade, 3D e anteprima, modello dei dati e formato.
   - **Sonnet** (`model: "sonnet"`): interfaccia e componenti, impostazioni, stampe, test, dati demo, documentazione.
   - Lavori indipendenti in parallelo con `isolation: "worktree"`, ciascuno su un ramo proprio (`granvelo/<tema>`), poi uniti da Fable in `granvelo-dev`. Mai due agenti sugli stessi file.
4. **Controllo**: Fable rilegge ogni consegna, lancia typecheck, test e build, prova l'anteprima `/?demo` (Playwright), rimanda indietro ciò che non va. Per le fasi delicate (1 e 4) fa una revisione con un agente che non ha scritto il codice.
5. **Chiusura**: nuova versione, push, **build verde su Windows**, "Come provare" per l'utente in parole semplici, aggiornamento di questo documento e della riga in 00, blocco "Decisione".
Regole di sempre: grafica solo da `packages/ui` (componenti nuovi lì e annotati in 02), niente dati fuori dal computer, nessuna retrocompatibilità dei file prima della pubblicazione, commit in inglese firmati come in 00.
