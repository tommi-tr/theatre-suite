# 08 — Bardo (scrittura dei copioni)

Stato: **specifica approvata il 9 novembre 2026; prima versione del codice scritta** (branch `bardo-dev`, PR #3). Avanzamento in `09_bardo_avanzamento.md`.
Anteprima grafica: https://claude.ai/artifact/9ZjUgMZj2fS9WY7dTkfM3V

## Decisioni del 9 novembre (risposte dell'utente)
- **Utenti**: autori, registi, compagnie amatoriali e professionisti. Windows 10/11 obbligatorio, macOS sì.
- **Lavoro**: una persona alla volta; tutto salvato sul computer.
- **La pagina è un documento modificabile tipo Word**, non un'anteprima PDF tipo Overleaf. I blocchi automatici ("macro": frontespizio, personaggi, cast, elenchi, indici, tabelle) sembrano testo e tabelle normali, ma li scrive Bardo dai dati.
- **Schede**: modo **A · Finestra** (es. la scheda Personaggi si apre come finestra, non nel foglio).
- **Identità**: accento **Rame** (#C8642C logo; #A9501F chiaro, #F2955E scuro); icona **A · Battute** in rame.
- **Formatta**: la scelta del modello sta nella barra in alto a sinistra e apre la finestra **Modelli**: modelli pronti, **Personalizzato** (dopo la prima modifica a un modello) e **Salva come modello** (si aggiunge alla finestra, per tutti i copioni).
- **Versioni**: restano **dentro il file `.bardo`**, compresse (gzip). Le esportazioni (PDF, Word, LibreOffice, testo, copia Bardo) contengono **solo il testo attuale**: niente confusione per gli attori, file piccoli.
- **Importazione** da Word (.docx) e testo (.txt) nella prima versione: **algoritmo a regole più un po' di statistica, nessuna AI**, tutto sul computer.
- **Bardo prima del launcher.**

## Cos'è
Un ambiente per scrivere copioni teatrali **senza preoccuparsi della forma**. Si scrive il testo; impaginazione, numerazioni, elenchi, indici e tabelle si fanno e si aggiornano da soli (la filosofia di LaTeX), ma la pagina si vede sempre com'è stampata (come in Word).
Esempi: tolgo l'oggetto "pugnale" dal testo → sparisce dall'elenco degli oggetti; nella scheda Personaggi cambio AMLETO in HAMNET → cambia in tutto il copione.

In alto: titolo e file. Tre **fasi**: **Componi · Formatta · Invia**.
Identificativo: `it.theatresuite.bardo`. Interfaccia in italiano (predefinito) o inglese. Tema chiaro (predefinito), scuro o come il sistema. Esempi tratti da Shakespeare nella lingua del copione.

## Fase Componi
Tre colonne: **Struttura** a sinistra (albero trascinabile o miniature delle pagine), **pagina** al centro, **parentesi delle schede** a destra della pagina (etichetta + matita: clic = si apre la finestra della scheda).

Schede: **Titolo**, **Personaggi** (nome, descrizione breve e lunga, "nel copione mostra", ordine, dati calcolati; rinominare = rinominare ovunque), **Cast e troupe**, **Atto/Quadro**, **Scena** (titolo breve, luogo e tempo stampati, descrizione non stampata, dati calcolati, "in scena senza battute"), **Elenco automatico**.

Elementi del testo: **Battuta**, **Didascalia**, **Didascalia in battuta** (fra parentesi). Tastiera: nome a inizio riga → Tab → battuta; Invio a fine battuta → nuova riga con il completamento che propone chi risponde; Ctrl D → didascalia; "(" → didascalia in battuta; Maiusc+Invio → a capo nel verso.

Barra (ribbon): Appunti · Testo · Suddivisione (Atto, Quadro, Scena) · Categorie (Personaggio, Oggetto, Scenografia, Costume, Luce, Suono, Altre) · Inserisci (Elenco, Tabella, Indice, Immagine*, Simbolo) · Note (Nota, Piè di pagina*) · Revisione (Versione, Suggerimenti*, Ortografia) · **Formattazione manuale** (cambia la barra; vale solo per il testo selezionato). Annulla/Ripeti e Trova nella barra del titolo; Statistiche, Concentrazione, Segni, Pagine/Continua e zoom nella barra di stato. (* = prossima versione)

Categorie con scorciatoia Ctrl 1…6, tasto destro o completamento; "Segna anche le altre N volte". Completamento dalla seconda lettera con la categoria accanto; Tab sempre, Invio dopo aver scelto, Esc per testo normale.

Elenco automatico: una sola finestra per elenchi, indici, sommari e tabelle (cosa, forma, ordine, raggruppamento, cosa accanto a ogni voce, titolo).

Note di lavoro accanto alla pagina (non stampate). Versione proposta e modificabile; versioni precedenti nel file, consultabili e ripristinabili.

Menu del tasto destro: Taglia · Copia · Incolla · Incolla solo testo │ Segna come ▸ · Togli segno │ Trasforma in ▸ │ Rinomina ovunque… · Mostra dove compare · Apri la scheda │ Aggiungi nota · Inizia una nuova scena qui.

## Fase Formatta
Barra: **Modello** (in alto a sinistra, apre la finestra Modelli) · Pagina (A4/A5/Letter, margini speculari) · Nomi (sinistra, sopra, nella riga) · Numerazione (primo / I / 1, numeri di battuta) · Pagine (atto/scena su nuova pagina) · Filigrana.
Schermata: a sinistra gli **elementi** (battute, struttura, frontespizio ed elenchi, categorie); al centro gli **esempi** con Shakespeare (Battute, Atti e scene, Frontespizio ed elenchi, Pagina e margini, Intestazione e piè, Regole tipografiche) cliccabili; a destra lo **stile dell'elemento** (carattere, dimensione, grassetto/corsivo, maiuscoletto, spaziatura, allineamento, spazi, interlinea, colore).
Modelli pronti: **Classico** (predefinito), **Contemporaneo**, **Leggio**, **Dattiloscritto**.

Predefiniti (Classico): A4; Source Serif 4 12 pt, interlinea 1,35; nome a sinistra in maiuscoletto semigrassetto 11,5 pt; battuta rientrata 34 mm adattata al nome più lungo; didascalie in corsivo; atto su pagina nuova; numero di battuta a margine; intestazione titolo · atto e scena, numero di pagina in basso; margini documentazione 25 mm, copione 22/20/25/25 mm.
Regole: niente titolo in fondo alla pagina (almeno 3 righe dopo), niente righe isolate, didascalia unita alla battuta che segue, battuta divisa con nome ripetuto e "(segue)", sillabazione, virgolette e trattini tipografici.

## Fase Invia
1. **Formato**: PDF (predefinito: esattamente le pagine a schermo), Word .docx, LibreOffice .odt (stili con nome "Bardo · Battuta"…, caratteri di sistema), testo .txt, copia .bardo senza versioni vecchie.
2. **Contenuto**: tutto il copione, **copia per un attore** (battute evidenziate) o **per un reparto** (parole della categoria evidenziate); filigrana: nessuna, BOZZA, nome del destinatario, altro.
3. **Nome e destinazione**: nome con la versione (es. "Amleto - copione 2.3 - Ofelia.pdf"); salva sul computer · stampa · condividi e cloud (in arrivo).
Registro degli invii nel file. Anteprima dal vivo delle pagine. Nulla esce dal computer senza una scelta esplicita.

## Impostazioni
Lingua dell'interfaccia · lingua del copione (per documento) · tema · nome dell'autore · ortografia · scorciatoie (elenco) · salvataggio automatico e recupero dopo un crash.

## Bardo nella suite
Il copione è la fonte naturale della struttura dello spettacolo (atti, quadri, scene, personaggi, battute, voci di categoria) con identificativi stabili. In futuro una voce "Suono" potrà collegarsi a un cue di Diaframma, una "Luce" al banco luci. Bardo funziona sempre anche da solo.

## Tecnologia (versioni verificate il 9 novembre 2026)
Tauri 2.12.5 · React 19.3.1 · TypeScript 7.0.2 · Vite 8.3.7 · zustand 5.1.0 · ProseMirror (model 1.25.13, view 1.42.9…) · docx 9.15.3 · fflate 0.8.3 · Source Serif 4 e Courier Prime via @fontsource · vitest 5.1.0.
- Impaginazione dal vivo con spaziatori invisibili; fogli, intestazioni e piè disegnati dietro il testo.
- PDF: su Windows WebView2 PrintToPdf (salvataggio diretto); altrove la finestra di stampa del sistema ("Salva come PDF").
- File `.bardo`: JSON leggibile con numero di versione del formato, dati, testo e versioni precedenti compresse.
