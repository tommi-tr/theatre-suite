# 12 — Granvelo: cosa è stato realizzato e come provarlo (0.6.0, 17/11/2026)

`10_granvelo.md` resta la **specifica** (cos'è, design approvato, simboli, hardware, fasi 0 e 1, prova del cavo). Questo documento dice **cosa esiste davvero nella 0.6.0**, le scelte prese costruendo, cosa resta e come provare. (La fusione di 12 dentro 10 è stata lasciata perdere apposta: specifica e realizzato restano due documenti corti.)

## Stato
**Granvelo 0.6.0**, ramo `granvelo-dev`, PR verso `main` aperta. **Tutte le fasi (D, 0–5) sono fatte.** 306 test verdi, build Windows verde. Formato `.granvelo` **1**, mai cambiato. **Mai provata con un cavo USB-DMX vero né su Windows reale**: è l'unica cosa che manca.

## Allestimento (fasi 1, 2 e 5)
- Elenco luci per posizione, proprietà, indirizzi con conflitti in ambra, **Numera a clic**, mappa dei 512 canali, Controllo luci.
- **Palco 3D** (three.js 0.187.0, caricato solo quando serve, ridisegnato solo quando cambia qualcosa) con viste Prospettiva / Pianta / Frontale; ripiego 2D automatico senza WebGL. Il palco è sempre scuro.
- Strumenti **Sposta** (luci e, dalla 0.6.0, **americane**: un passo di Annulla per trascinamento), **Orienta**, **Scenografia**. **Selezione a riquadro**: Maiusc o Ctrl + trascina nel 3D, trascina e basta nel 2D. Le americane automatiche rimaste vuote dopo un trascinamento si tolgono da sole.
- Soglie del trascinamento: sotto 0,5 m la luce va a terra; zona alta da max(2 m, 60% dell'altezza): un'americana entro 0,6 m di profondità e 1 m di altezza la aggancia, altrimenti sopra il palco ne nasce una nuova; in sala resta fluttuante.
- **Scenografia per memoria**: Scenografia → "Scenografia di una memoria": i pezzi entrano, escono e si spostano memoria per memoria (il formato 1 lo prevedeva già). Si modifica in Allestimento, non dal Banco.
- **Stampe per gli elettricisti** (pulsante "Stampa" e File → Stampa…): anteprima con Pianta / Elenco / Tutte e due; pianta A4 orizzontale (numero e indirizzo sotto ogni luce, americane con nome e misure, legenda), elenco A4 verticale per posizione con "non usata"; nero su bianco, stampa di sistema ("Microsoft Print to PDF" per il PDF).
- **Dettaglio dell'anteprima**: Essenziale, Media, **Alta** (ombre della scenografia, fasci come nel fumo, alogeni più caldi quando si abbassano), **Automatica** (misura breve: al massimo 30 immagini o 2,5 s, su un palco di prova; sceglie il livello, lo salva sul computer, "Misura di nuovo" nelle Impostazioni).

## Banco (fase 3, rifinito nella 5)
- Vista frontale che segue i cursori; una scheda per luce con un cursore per canale; gruppi e Grand Master; memoria in scena con "modificata, non salvata" (Salva / Salva come nuova / Ripristina); selettore colore; elenco delle memorie **nell'ordine dello spettacolo**, con i pulsanti prima / dopo.
- Cursori: trascinamento, rotella (Maiusc = fine), valore digitabile, frecce; 0–255 o %.
- **Blind** (pulsante, Ctrl B, fascia blu, Esc): nulla va all'uscita. Cambiando modalità si esce da Blind in modo pulito (chiede se salvare).
- Entrando nel Banco i cursori partono da ciò che è davvero in scena. Caricare una memoria sopra i cursori alzati del "banco libero" chiede conferma.
- Annulla proprio del banco (movimenti raggruppati in 1,2 s). I gruppi li applica l'interfaccia, il Grand Master solo il motore.

## Show (fase 4)
- **Nastro**: IN ONDA (verde) · riquadro della transizione che si riempie · PRONTA (ambra) · le successive. **GO** (Spazio), **Indietro** (Backspace), **Pausa** (P). "Sequenza" per ordine e transizioni (crossfade, salita e discesa, ritardo, parte da sola, teste mobili al buio).
- Banco **No · Mini · Compatto · Esteso** su una riga propria. Barra in basso: Memoria N di M, durata della serata, **Blackout `B`**, **Fade to black `F`**, **Emergenza `E E`**.
- **Lock** (Ctrl L esatto; Ctrl+Maiusc+L è "Torna al launcher"): restano GO, Indietro, Pausa, Blackout, FTB, Emergenza, Ctrl S e Connetti.
- **Blind in Show** lavora sulla memoria pronta. **Controllo luci** dallo Show.
- **Test di affidabilità** (Impostazioni → Test): fa girare tutta la sequenza senza uscita e dà un rapporto a parole.
- Codice: `src/model/show.ts` (macchina a stati pura), `src/store/show.ts`, `src/model/sequence.ts`, `src/model/reliability.ts`. Le dissolvenze le calcola il motore Rust (non toccato nelle fasi 4 e 5): finiscono anche se l'interfaccia si blocca. Tabella delle scorciatoie in `README.md`.

### Scelte prese dove la specifica taceva
- **Indietro**: va alla memoria prima di quella in onda, con i tempi di quella memoria, mai "parte da sola"; sulla prima non fa nulla.
- **Parte da sola**: si legge alla fine della dissolvenza (toglierla sulla memoria in onda ferma la catena); continua anche se si passa al Banco.
- **Emergenza**: la memoria scelta va in scena com'è (gruppi e Grand Master non la abbassano); finché è attiva rifiuta GO, Indietro, Pausa, Blackout, FTB e il cambio di modalità, e il banco è spento; si esce con "Torna allo spettacolo" (dissolvenza con il crossfade predefinito).
- **GO senza uscita collegata**: lo spettacolo avanza lo stesso, con un avviso.
- **Cursore mosso durante una dissolvenza**: la dissolvenza prosegue fino alla sua fine (si perdono solo ritardo e "al buio").
- Impostazioni nuove sul computer: tempo del Fade to black (5 s), banco dello Show (Compatto), livello misurato dell'anteprima.

### Revisione indipendente dello Show (17/11)
Quattro difetti corretti, ognuno con un test: salto del palco muovendo un cursore in dissolvenza; lo stesso nei primi 100 ms dopo il GO; l'Emergenza sostituibile da una modifica al documento; "parte da sola" letta al GO invece che alla fine.

## Limiti noti
- Muovere un cursore con una dissolvenza **in pausa** fa saltare il palco alla fine della dissolvenza.
- Nello Show i cursori mostrano la memoria verso cui si va, non i valori intermedi.
- "Parte da sola" dipende dall'orologio dell'interfaccia (100 ms): può tagliare gli ultimi millisecondi della dissolvenza precedente; non si accumula.
- Durante una dissolvenza il riquadro della transizione tra IN ONDA e PRONTA è nascosto finché non c'è spazio.
- Automatica provata solo con grafica software. Stampe provate solo come PDF di Chromium.
- `model/ops` dipende ancora da `stage/geometry` (entrambi puri).
- **Proposte LightStage bocciate dall'utente (16/11) e non costruite**: "Punta qui", "Trova", taratura delle teste mobili.
- Non decisi: inserimento nel launcher (aprire, creare, installare Granvelo), collegamenti con le altre app.

## Come provare la 0.6.0
1. GitHub → **Actions** → "Granvelo · Windows installer" → ultimo run verde del ramo `granvelo-dev` → in fondo, **Artifacts** → scaricare, scompattare, lanciare `Granvelo_0.6.0_x64-setup.exe` ("Windows ha protetto il PC" → Ulteriori informazioni → Esegui comunque). In alto a destra deve esserci **Granvelo 0.6.0**.
2. "Apri lo spettacolo di prova" (*La locandiera*). **Allestimento**: girare il palco (sinistro gira, destro sposta, rotella zoom); con **Sposta** trascinare una luce e poi un'americana, Ctrl Z; Maiusc + trascina nel vuoto per selezionare più luci; **Scenografia** → scegliere una memoria e togliere o spostare un pezzo.
3. **Stampa** → guardare i fogli → "Stampa…" → "Microsoft Print to PDF".
4. Impostazioni → **Anteprima**: Alta, poi Automatica e "Misura di nuovo". Impostazioni → **Test**: avviare il test di affidabilità e leggere il rapporto.
5. In alto a sinistra **Connetti** → "Usa l'uscita simulata" (o il cavo vero). **Banco**: muovere cursori, gruppi e Grand Master; cliccare una memoria; cambiare un cursore (compare "modificata, non salvata"); Ctrl+clic su un'altra memoria e **Ctrl B** per Blind, Esc.
6. **Show**: Spazio (GO) più volte, P durante una dissolvenza, Backspace; B due volte; F due volte; E due volte e poi "Torna allo spettacolo"; provare No / Mini / Compatto / Esteso; "Sequenza" per cambiare un tempo; **Lock** (Ctrl L) e controllare che il GO funzioni ancora.
7. Salvare, chiudere, riaprire con doppio clic sul file `.granvelo`.
8. **Con il cavo USB-DMX**: la prova del cavo di `10_granvelo.md` ("Come provare la 0.2.0"), soprattutto Impostazioni → Uscita DMX → "Copia i dettagli del cavo"; poi rifare il punto 6 con le luci vere, guardando che prima di Connetti non succeda nulla e che Blind non cambi il palco.
9. Annotare ciò che non è chiaro a prima vista.
