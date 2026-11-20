# Cue 0.6.0 — Come provare (test globale)

Cue lavora con i file di Diaframma (suono) e Granvelo (luci). Prima di iniziare tieni a portata di mano uno spettacolo con un copione in PDF, un file `.diaframma` con qualche traccia e un file `.granvelo` con qualche memoria (vanno bene quelli di prova).

## 0. Installare
1. GitHub → **Actions** → "Cue · Windows installer" → l'ultimo run verde del ramo `cue-dev` → in fondo **Artifacts** → scarica `Cue-Windows-installer` ed estrai lo zip.
2. Doppio clic su `Cue_0.6.0_x64-setup.exe`. Se compare "Windows ha protetto il PC": **Ulteriori informazioni → Esegui comunque**.
3. Allo stesso modo installa, dallo stesso ramo, il **launcher 0.4.4** ("Launcher · Windows installer"), **Granvelo 0.6.1** e **Diaframma 0.3.2**: hanno i motori spostati e devono comportarsi esattamente come prima (una prova veloce: apri un file, un GO, un fade).

## 1. Un solo PC
1. Apri Cue: "Da dove vuoi iniziare?" → **Nuovo spettacolo**, salvalo (Ctrl S) nella cartella dello spettacolo, accanto ai file di Diaframma e Granvelo.
2. **Prepara** → **Carica il copione** → scegli il PDF. Prova rotella, W/S, ←/→ (zoom); tieni premuto **Ctrl** e scorri: lasciando Ctrl il copione torna dov'era. Premi **K** per una nota: compare la colonna Note a sinistra.
3. A sinistra **File collegati** → aggiungi il `.diaframma` e il `.granvelo`. Nelle schede **Luci** e **Audio** compaiono memorie e tracce: **trascinale sul copione**. Un elemento lasciato vicino a un GO esistente si unisce a quel GO. A destra, nel pannello del GO, prova "Chi lo dà", i tempi (diventano ambra), "Parte da sola".
4. Impostazioni (ingranaggio) → **Uscite**: scegli la scheda audio; per le luci collega l'interfaccia DMX (**chiudi prima Granvelo**: il cavo lo usa un programma alla volta, e Cue te lo dice).
5. **Show**: Spazio = GO, Backspace = Indietro; clic su un GO futuro = diventa standby (non parte). Prova P (pausa), B (blackout), F (fade to black), E E (emergenza), Esc (ferma l'audio), Ctrl L (blocco; si sblocca tenendo premuto). Le linee verde (ultimo GO) e ambra (standby) devono essere in primo piano e le scatole allineate ai pulsanti.
6. **Controlli**: stato delle uscite, **Prova in silenzio** (prova a secco), lista "Prima del sipario" con una tua voce, **Registro della serata**, **Esporta il rapporto**, **Fine spettacolo**.
7. Chiudi Cue dal Gestore attività durante lo Show e riaprilo: deve proporre **Recupera** e ripartire dallo standby **senza lanciare nulla**.

## 2. Due istanze sullo stesso PC (prova della rete senza cavo)
1. Trova il programma: clic destro sull'icona di Cue → **Apri percorso file** (di solito `C:\Users\<nome>\AppData\Local\Cue\cue.exe`).
2. Apri **Prompt dei comandi** e scrivi (con il tuo percorso):
   `"C:\Users\<nome>\AppData\Local\Cue\cue.exe" --instance 2`
   poi, in un secondo Prompt, lo stesso con `--instance 3`. Nella barra del titolo vedi "Istanza 2" e "Istanza 3".
3. Nella prima: Impostazioni → **Collegamento** → **Primario** (leggi l'avviso del firewall, poi "Ho capito, attiva"; se Windows chiede, consenti sulle **reti private**). Compare un codice di 6 cifre.
4. Nella seconda: **Secondario** → scegli il primario trovato → scrivi il codice. Il secondario riceve lo spettacolo ("Spettacolo ricevuto dal primario").
5. Prova: GO da entrambi; tieni premuto **C** su uno (prenotazione blu, l'altro vede "Prenotato…"); "Togli i comandi" sul primario; "Non disponibile" sul secondario (velo blu, si torna tenendo premuto); chat; chiudi il primario → il secondario diventa rosso "Il primario non risponde".

## 3. Due PC con il cavo Ethernet
1. Collega i due PC con un cavo Ethernet diretto (nessuno switch). Aspetta circa un minuto: Windows dà indirizzi automatici 169.254.x.x.
2. Installa Cue su entrambi, apri lo **stesso** spettacolo solo sul primario (il secondario lo riceve).
3. Stessi passi del punto 2 (senza `--instance`). Controlla il bordo verde e "Connesso · x ms". Stacca il cavo: bordo e pannello rossi "Scollegato da…", il primario continua normalmente; riattacca: torna verde. Se hai il Wi-Fi su entrambi, prova "Wi-Fi di riserva" (ambra "Ora su Wi-Fi di riserva" quando stacchi il cavo).

## 4. Pedale
La parte Arduino è rimandata (Impostazioni → Tasti → Pedale: "Prossimamente"). Un qualunque pedale o tastiera che manda **F13** funziona già come GO, anche con il campo della chat attivo.

## 5. Proiettore
1. Collega il proiettore come **secondo schermo** (Windows: Win P → Estendi).
2. **Proiezioni**: aggiungi immagini e un video MP4 (H.264) che stia nella cartella dello spettacolo; prova transizioni e colore.
3. Impostazioni → **Proiezioni**: scegli lo schermo, **Apri l'uscita**, **Schema di prova**. In Show, **T** = tappo (nero o immagine scelta).
4. PowerPoint: consigliato esportare la presentazione in PDF e importarla come immagini; il comando dal vivo (avanti/indietro) richiede PowerPoint installato e aperto.

## Cosa dirmi
Per ogni punto: funziona / non funziona / strano, con una foto dello schermo se qualcosa non torna. Utilissimi: il ritardo che vedi con il cavo, se i video partono, se il proiettore si apre sullo schermo giusto, se Granvelo e Diaframma si comportano come prima.

## Limiti noti di questa versione
- Mai provato su Windows reale: finestre di sistema, recupero dopo crash, uscita sul secondo schermo, video, PowerPoint, rete vera.
- **Bardo come copione** non c'è ancora: per ora esporta il copione da Bardo in PDF e caricalo.
- "Fine spettacolo" tiene le modifiche nel file di Cue; non le riscrive nei file di Diaframma e Granvelo.
- Il registro della serata resta in memoria finché Cue è aperto (esportalo prima di chiudere).
- Il codice di abbinamento a 6 cifre basta per un cavo diretto, ma i messaggi sono firmati e non cifrati.
- Nessun tono di prova audio; scatole molto corte nelle colonne tagliano il nome.
