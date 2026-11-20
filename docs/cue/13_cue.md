# 13 — Cue (regia dello spettacolo dal vivo) — copia di lavoro della specifica

Copia nel repository del documento di progetto `13_cue.md` (specifica approvata il 20/11/2026, design approvato il 20/11/2026 notte). Riferimento visivo: `docs/cue/design/` (anteprima e immagini). Piano tecnico: `docs/cue/WORKPLAN.md`. Identificativo `it.theatresuite.cue`, file **`.tcue`**, ramo `cue-dev`, porta di sviluppo **1425**.

## Cos'è
L'**unica schermata che si guarda durante lo spettacolo**. Tutto si prepara prima nelle altre app (Bardo, Diaframma, Granvelo); in Cue si **posizionano i GO sul copione** e si manda in scena. È il libro di scena digitale di chi chiama lo spettacolo, più il comando di luci, audio, immagini e video. Un secondo computer può condurre lo stesso spettacolo alla pari.
- Utenti: compagnie amatoriali e piccole produzioni: parole semplici, nessun gergo non spiegato.
- Solo Windows 10/11; schermo di riferimento 1366 × 768 (usabile a 1280 × 720). Tema predefinito **scuro**. Italiano predefinito, interfaccia predisposta per l'inglese. Parole di teatro in inglese anche in italiano (GO, Standby, Blackout, Fade to black, Show…).

## Scelta di fondo: motori condivisi
Il motore audio di Diaframma e il motore DMX di Granvelo si spostano in crate condivisi (`crates/audio-engine`, `crates/dmx-engine`); **Diaframma e Granvelo continuano a usarli identici** (comportamento e test invariati) e Cue li usa leggendo i file `.diaframma` (formato 3) e `.granvelo` (formato 1). Durante lo spettacolo è aperto **un solo programma**. Il cavo DMX lo apre un programma alla volta: se Granvelo lo tiene, Cue lo dice in chiaro. Se la lettura dei file o il modello delle memorie/tracce serve anche in TypeScript, va in un pacchetto condiviso, non copiato.

## Modalità (selettore in alto al centro)
1. **Prepara** — stessa disposizione dello Show, con le **librerie** a sinistra (schede Luci · Audio · Video: memorie di Granvelo con miniatura, tracce di Diaframma, immagini e video): si trascinano sul copione per creare i GO; elementi sullo stesso punto = **un GO unico** con più azioni. A destra, al posto del pannello di collegamento, il **GO selezionato** (punto del copione, azioni con il filetto nel colore del reparto e i tempi, "Chi lo dà" a tre segmenti, zona di velocità, note, Elimina). Le zone di velocità sono strisce nell'accento sul margine del copione. Si regola anche la larghezza delle colonne.
2. **Proiezioni** — sequenza a sinistra (miniature, transizione scritta fra un elemento e l'altro, in scena verde, prossimo ambra), anteprima dell'uscita al centro con bordo ciano e scritta "In uscita / prossimo", ritocco a destra (transizione: taglio, dissolvenza, attraverso il nero, con durata; luminosità, contrasto, temperatura, saturazione per "Questo" o "Tutti"; valori modificati in ambra; a fine video). Immagine **tappo** (nero o scelta), schermo di uscita, PowerPoint.
3. **Controlli** — una scheda per uscita (Audio, Luci DMX, Proiettore, Secondario, PowerPoint, Pedale) con lo stato in parole e il colore (StatusLight) e il comando di prova; a destra la **lista di controllo prima del sipario** ("6 di 9") con voci proposte (test uscita audio, controllo luci, schema di prova sul proiettore, secondario connesso, file verificati, promemoria Windows: Non disturbare, alimentazione, aggiornamenti) **e voci aggiunte dall'utente** (segnate "tua"), salvate nel file; si spuntano e finiscono nel registro della serata.
4. **Show** — la schermata dello spettacolo.
Impostazioni nella solita finestra a categorie (Generali, Copione, Tasti, Collegamento, Uscite, Proiezioni, Test, Informazioni).

## Schermata Show
- **Copione a sinistra.** Un **puntino** a margine segna in modo univoco il punto di ogni GO.
- Da ogni puntino una **linea** (dritta, smussata quando serve) porta al **pulsante del GO**. Se due GO sono vicini i pulsanti non si sovrappongono: si scostano e la linea si curva.
- Pulsanti: **grigio** = GO passato; **verde** = ultimo GO dato; **ambra** = **standby** (parte al prossimo GO); neutro = futuri.
- Dal pulsante le linee proseguono verso le **colonne Luci · Audio · Video** (anteprima della memoria come in Granvelo, nome della traccia come in Diaframma, miniatura dell'immagine o del video).
- **Allineamento**: il **lato superiore** di ogni scatola di un GO è allineato al **lato superiore del pulsante del GO**; il pulsante è alto 34 px e la linea entra **a metà altezza**, quindi finisce dentro il pulsante e dentro le scatole, mai sul loro bordo. Il contenuto delle scatole parte sotto la linea (etichetta IN SCENA / STANDBY, miniatura, nome).
- **Linee del GO dato e dello standby colorate e in primo piano**: tutta la linea (puntino, tratto verso il pulsante, tratto attraverso le colonne fino all'ultima scatola di quel GO) è verde per l'ultimo GO dato e ambra per lo standby (blu quando lo standby è prenotato da sé), spessa 2,5 px, **sopra** anteprime, tracce e tutto il resto. Le altre linee restano grigie, sotto le scatole.
- **Le colonne scorrono con il copione** (linea del tempo allineata alle pagine). La scatola di una **memoria** o di un'**immagine/video** si allunga fino al GO successivo della stessa colonna; quella dell'**audio** ha l'altezza scelta dall'utente trascinandola (maniglia in basso; solo promemoria visivo). Ogni colonna mostra in verde ciò che è in scena per quel reparto, anche se è partito molti GO prima. Ogni scatola ha in alto un filetto di 3 px nel colore del reparto (luci magenta, audio indaco, video ciano); il titolo della colonna ha lo stesso segno.
- **Una colonna vuota non esiste** e le altre si allargano. Colonna **Note** (commenti al copione) **a sinistra del copione**, anch'essa solo se ci sono note.
- **Divisore trascinabile** fra copione e colonne; la larghezza si ricorda nel file.
- **Pannello di collegamento a destra** (200 px): primario/secondario, stato e ritardo della connessione in grande, disponibilità, "Togli i comandi" (sul secondario: "Non disponibile"), chat con messaggi rapidi e campo "Scrivi…". **Tutto il pannello ha come sfondo il colore dello stato del collegamento**: stabile = verde tenue (`--go-bg`); instabile o Wi-Fi = **ambra pieno**; scollegato = **rosso pieno**; secondario non disponibile = **blu pieno**; sui colori pieni testo scuro (bianco sul rosso) e bolle/pulsanti in una velatura scura. Senza secondario: pannello neutro con "Nessun secondario".
- **Barra in basso**: a sinistra running time e "GO n di N"; a destra i comandi a scritta con il tasto: Pausa P, Piazzato Q, Tappo T, Blackout B, Fade to black F, Emergenza E E in rosso.
- **Bordo dello schermo** spesso (6 px) nel colore della connessione, solo quando c'è un secondario collegato.
- **Niente riquadri riassuntivi** che mescolano suoni, luci e immagini.
- Il GO si dà con **Spazio** o con il **pedale**. Un clic su un pulsante futuro lo rende standby; un clic sullo standby **non** lo lancia.

## Il copione
- **Un solo PDF per file** (copione o partitura), oppure un copione di Bardo. Mai modificabile in Cue.
- Sottolineature e commenti già presenti nel PDF si vedono in sola lettura; le note nuove stanno nel file di Cue.
- Scorrimento: rotella, ↑ ↓ o W S. Frecce ← → o A D: **zoom** (predefinito) oppure cambio pagina (Impostazioni).
- **Ctrl tenuto = sbirciata**: finché si tiene Ctrl si scorre liberamente (la rotella scorre, non fa zoom); una fascia neutra "Sbirciata · lascia Ctrl per tornare al GO n" e una riga tratteggiata "qui eri" segnano il punto; lasciando Ctrl il copione **torna con uno scorrimento visibile** al punto in cui era. Le colonne seguono.
- **Carta del copione separata dal tema dell'app**: Impostazioni → Copione → **Carta bianca** (predefinita) · **Carta scura** (carta invertita, luminosità regolabile).
- **Ancore**: GO e note sono legati a un punto del testo (pagina, posizione, testo intorno). "Sostituisci copione" ricolloca le ancore cercando il testo; le incerte in ambra da confermare (anteprima prima di confermare). Con Bardo l'ancora è l'id della battuta; le voci Suono e Luce di Bardo diventano proposte di GO.
- **Scorrimento automatico**: velocità generale e **zone di velocità** lungo il copione, una zona può partire da un GO; regolabile al volo. Scorrere a mano lo sospende; **"Segui"** lo riprende. Ogni computer scorre per conto suo.
- Nessun lampeggio automatico dello standby.

## Il file `.tcue`
**Contenitore zip**: `show.json` (`format: "theatre.cue"`, `formatVersion: 1`), `script.pdf`, miniature, immagini delle proiezioni. Un file = uno spettacolo intero. Comandi "Sostituisci copione" ed "Esporta il PDF".
- **Restano fuori**: i **video** (nella cartella dello spettacolo, percorso relativo + impronta), le tracce e le memorie (nei file di Diaframma e Granvelo, riferiti per id del documento, percorso relativo e id stabile dell'elemento).
- Scrittura atomica; le parti che non cambiano si ricopiano senza ricomprimerle; salvataggio automatico e recupero dopo crash; versioni in `Spettacolo.versions/`.
- Nessuna retrocompatibilità fino alla prima pubblicazione. Campi sconosciuti conservati al salvataggio.

## I GO
- Un GO ha numero, punto sul copione, una o più azioni (memoria di Granvelo, traccia di Diaframma, immagine/video o passo delle proiezioni, avanti/indietro di PowerPoint) e **"chi lo dà"**: entrambi (predefinito) · solo primario · solo secondario.
- **Il GO avvia sempre lo standby**, mai ciò che si vede sullo schermo.
- Ordine = ordine del copione; la stessa memoria può tornare. Le partenze automatiche (Next/Crossfade di Diaframma, "parte da sola" di Granvelo) si vedono come GO "parte da sola".
- Tempi: quelli dei file, modificabili in Cue. **Indietro** torna al GO precedente.
- Colore del tipo: **audio indaco, luci magenta, proiezioni ciano**; verde, ambra, rosso, blu col significato di sempre.

## Doppio GO
1. **GO assegnati** (Prepara): chi non ha il GO vede il pulsante grigio con "lo dà il secondario" / "lo dà il primario".
2. **Prenotazione**: **finché si tiene premuto un tasto** (predefinito **C**) solo quel computer può dare i GO. Sul proprio schermo lo standby ha il contorno **blu**, la sua linea diventa blu e sopra le colonne compare la fascia blu "Prenotato da te · solo tu puoi dare il GO C"; sull'altro il GO è grigio con "Prenotato dal primario/secondario". Se premono entrambi vince chi arriva prima al primario. Se la connessione cade, la prenotazione del secondario decade all'istante.
3. **Nessuna rete di sicurezza a tempo**. Fuori da 1 e 2 ogni GO valido parte.
Emergenza, Blackout, Fade to black e Pausa funzionano sempre da entrambi i computer.

## Tasti
Spazio GO · Backspace Indietro · Pausa `P` · Piazzato `Q` · Tappo `T` · Blackout `B` · Fade to black `F` · Emergenza `E E` · Stop audio `Esc` · Prenota `C` (tenuto) · Lock `Ctrl L` esatto · sbirciata Ctrl tenuto · W A S D e frecce. In Prepara: Nuovo GO qui `N`, Nota `K`. Tutti modificabili con controllo dei conflitti. Con la chat in uso i tasti vanno alla chat, tranne il pedale.
- **Pedale**: Arduino che fa da tastiera USB e manda **F13**. Accettato anche con la chat aperta. Impostazioni → Tasti → "Premi il pedale". **(Parte Arduino rimandata: nell'interfaccia solo "Prossimamente".)**

## Primario e secondario
- **Primario** = computer di regia: esegue tutto ed è l'unica fonte di verità. **Secondario** = un solo altro computer, **seconda interfaccia del primario**, alla pari: ogni richiesta passa dal primario, che la applica e la mostra a entrambi. Su una stessa cosa modificata da entrambi vale l'ultima. Il primario può **togliere i comandi** al secondario.
- Il primario manda il `.tcue` al secondario alla connessione (e ogni modifica dopo). Verifica d'impronta; se diversa vince il primario.
- **Rete**: cavo Ethernet diretto (169.254.x.x). Battito ogni 100 ms con numero progressivo e misura del ritardo; richieste con conferma e ripetizione; **abbinamento** con codice a 6 cifre e messaggi firmati. Prima volta: permesso del firewall di Windows, spiegato prima.
- **Wi-Fi di riserva** spento di default; se acceso i messaggi viaggiano su entrambe le strade e si scartano i doppioni.
- **Bordo e pannello**: verde tenue = stabile ("Connesso · 0,4 ms", "Via cavo · disponibile"); **ambra** = instabile o su Wi-Fi ("Instabile · 38 ms, 3 battiti persi", "Ora su Wi-Fi di riserva"); **rosso** = scollegato ("Scollegato da 0:04"; sul primario "Il secondario non può dare GO. Tu continui normalmente"); **blu** = secondario non disponibile ("Non disponibile · sei solo"). Sempre con una scritta. **Nessun suono d'allarme**.
- **Non disponibile**: velo e scheda blu "Non disponibile · le tue scorciatoie sono spente", si torna con "Tieni premuto per tornare disponibile" (HoldButton).
- Se il primario si spegne il secondario mostra "Il primario non risponde. Non puoi continuare da qui" (pannello rosso).
- **Chat** con messaggi rapidi ("Standby", "Attori pronti", "Aspetta", "Ok", "Ritardo 5 min") più testo libero, con mittente e ora. **Puntatore dell'altro** sul copione, a bassa priorità.

## Proiezioni e PowerPoint
- Finestra a schermo intero sul secondo schermo del primario; immagini e video (MP4 H.264), transizioni, colore, tappo.
- **PowerPoint**: importazione delle diapositive come immagini **e** comando dal vivo di PowerPoint installato (avanti/indietro/vai a).

## Modifiche al volo e fine spettacolo
Modifiche durante lo show segnate in ambra "modificato in serata". A fine spettacolo, una sola volta per entrambi: **Applica ai file originali** (prima una versione automatica) · **Salva come nuova versione** (con nota) · **Dimentica**.

## Registro della serata
Ogni GO con ora e computer, inizio, intervallo, fine, modifiche, problemi di connessione, chat, lista di controllo. Esportabile come rapporto (testo e stampa di sistema).

## Affidabilità
Motori separati dall'interfaccia; dopo un crash Cue riparte sullo standby a cui era **senza rilanciare nulla**; niente sospensione di Windows con Cue aperto; **prova a secco** in silenzio con rapporto; Lock; test di affidabilità nelle Impostazioni → Test.

## Nella suite
Documento del progetto di spettacolo (fase Spettacolo): il launcher lo crea, lo apre, lo elenca; "Tutto pronto per la serata" controlla anche i suoi riferimenti. Pagina Theatre Suite con 5 app. Barra del titolo e "Torna al launcher" come le altre app. **Accento Gesso, icona Filo, proiezioni ciano.**

## Fasi
| Fase | Contenuto | Versione |
|---|---|---|
| 0 | Motori in crate condivisi; componenti di Granvelo comuni in `packages/ui`; scheletro `apps/cue`, `.tcue` formato 1, Impostazioni, CI Windows; launcher con Cue | 0.1.0 |
| 1 | Copione: PDF, navigazione, zoom, sbirciata, carta bianca/scura, note, ancore, divisore | 0.2.0 |
| 2 | GO e Show su un computer: librerie, GO uniti, colonne, standby, motori, tasti, Lock, scorrimento automatico, pedale | 0.3.0 |
| 3 | Primario e secondario (prova con due istanze sullo stesso computer) | 0.4.0 |
| 4 | Proiezioni, video, PowerPoint | 0.5.0 |
| 5 | Controlli e lista, modifiche al volo e fine spettacolo, registro, Bardo come sorgente, prova a secco, rifiniture | 0.6.0 |
