# 12 — Granvelo: avanzamento dopo le fasi 2 e 3 (16/11/2026)

Completa `10_granvelo.md` (specifica, design, fasi 0 e 1, prova del cavo), che resta valido: **qui c'è ciò che è cambiato dalla 0.2.0 alla 0.4.0 e ciò che manca**. Nella tabella delle fasi di 10, le fasi 2 e 3 sono da considerare **fatte**. Alla chiusura di Granvelo (0.6.0) questo documento va fuso dentro 10.

## Stato
**Granvelo 0.4.0** sul ramo `granvelo-dev` (nessuna PR ancora). Fatte le fasi D, 0, 1, 2, 3. **Mai provata con un cavo USB-DMX vero né su Windows reale.** Restano le fasi 4 e 5, da fare insieme in **un'unica chat**: l'utente scrive "**Granvelo, fasi 4 e 5**".

## Realizzato nella fase 2 (Allestimento 3D, 0.3.0)
- **Modulo del palco** (`apps/granvelo/src/stage/`, riusabile, senza legami con gli store): vista 3D con **three.js 0.187.0** (caricata solo quando serve, ridisegnata solo quando cambia qualcosa) e viste 2D in SVG (pianta e frontale), che sono anche il ripiego automatico senza WebGL e le miniature delle memorie. Dettaglio Essenziale / Media (Alta e Automatica disegnano come Media fino alla fase 5). Il palco è sempre scuro, anche con il tema chiaro.
- **Allestimento**: selettore "Palco · Mappa degli indirizzi"; viste Prospettiva / Pianta / Frontale; strumenti **Sposta**, **Orienta**, **Scenografia**, **Numera a clic** (anche cliccando sul palco). Ogni trascinamento è un solo passo di Annulla. Clic su un'americana = nome e misure nell'elenco. "Puntamento predefinito" nelle proprietà. Con l'uscita collegata o simulata le luci mostrano ciò che stanno facendo.
- **Soglie del trascinamento**: sotto 0,5 m la luce va a terra; zona alta da max(2 m, 60% dell'altezza del palco): un'americana entro 0,6 m di profondità e 1 m di altezza la aggancia, altrimenti sopra il palco (fino a 1 m oltre i lati) nasce un'americana nuova; in sala la luce resta fluttuante.
- **Pozze di luce**: ellisse esatta se il puntamento è a terra; disco approssimato se è in aria; fasci sotto 8° = una fascia; fasci verso l'alto oltre 30° = nessuna pozza.
- Il formato del file **non è cambiato** (formato 1).

## Realizzato nella fase 3 (Banco, 0.4.0)
- Codice in `src/modes/desk/`, `src/store/desk.ts`, `src/model/desk.ts`.
- **Schermata**: vista frontale che segue i cursori; una **scheda per luce** con un cursore per canale (campione di colore, nome del canale, numero DMX); **gruppi** (crea dalle luci selezionate, rinomina, elimina) e **Grand Master**; a destra la memoria in scena ("modificata, non salvata" in ambra, Salva / Salva come nuova / Ripristina), il **selettore colore**, l'elenco delle memorie con miniatura (clic = in scena subito, senza dissolvenza). Funziona anche senza memorie ("banco libero").
- **Cursori**: trascinamento, rotella (Maiusc = passi fini), clic sul valore per digitarlo, frecce da tastiera; 0–255 o % secondo le Impostazioni. È un componente nuovo di Granvelo (quello condiviso non ha colore di riempimento né valore digitabile): da annotare in 02.
- **Blind**: pulsante in alto a destra e **Ctrl B** sulla memoria selezionata (Ctrl+clic nell'elenco, oppure il pulsante Blind che compare sulla riga); fascia blu, Esc per uscire (chiede se salvare). In Blind **nulla va all'uscita** e gruppi e Grand Master sono fermi.
- **Annulla nel Banco**: il banco ha una sua cronologia (i movimenti dei cursori si raggruppano in 1,2 s); Ctrl Z agisce prima sul banco, poi sul documento.
- **Uscita**: i gruppi li applica l'interfaccia, il Grand Master solo il motore (mai due volte).
- I cursori sono già pronti nelle tre densità **Esteso / Compatto / Mini** per lo Show (`<DeskFaders density>`); Compatto e Mini non sono ancora stati guardati a schermo.

## Da fare nella prossima chat (fasi 4 e 5 → 0.6.0)
- **Fase 4, Show** (specifica in 10): Nastro, GO / Indietro / Pausa, transizioni modificabili e ordine delle memorie, Blackout, Fade to black, Emergenza, Lock, Blind anche in Show, banco No / Mini / Compatto / Esteso, Controllo luci dallo Show, test di affidabilità, controllo delle scorciatoie, **revisione indipendente** del motore dello Show.
- **Fase 5**: stampe per gli elettricisti (pianta ed elenco), anteprima Alta e Automatica, rifiniture.
- **Lasciato indietro dalle fasi 2 e 3** (da chiudere nella 5):
  - spostare le americane con il mouse; togliere le americane automatiche rimaste vuote; selezione a riquadro;
  - **scenografia diversa per ogni memoria** (entra, esce, si sposta): oggi i pezzi si disegnano ma non si cambiano memoria per memoria;
  - vista frontale del Banco con margini troppo larghi; nomi dei gruppi troncati;
  - entrando nel Banco i cursori partono dai valori del banco, non da ciò che è davvero in scena (serve allo Show);
  - uscire dal Banco con Blind attivo lascia Blind acceso e l'uscita ferma (da chiudere insieme al Blind dello Show);
  - caricare una memoria dal "banco libero" con i cursori alzati non chiede conferma (si recupera con Annulla);
  - `model/ops` dipende da `stage/geometry` (entrambi puri): valutare se spostare la geometria nel modello;
  - annotare in `02_design.md`: cursore di Granvelo, pillola dell'uscita, fascia Blind, icone nuove.
- Proposte LightStage ancora da decidere con l'utente: "Punta qui", "Trova", taratura delle teste mobili.
- **Economia**: come in questa chat, un agente per fase in sequenza (Opus per il motore dello Show, Sonnet per stampe e rifiniture), controllo di Fable con typecheck, test e una schermata; una sola attesa della build Windows alla fine. `add_repo` va chiesto in **lettura** (il push sul ramo funziona).

## Come provare la 0.4.0
1. GitHub → Actions → "Granvelo · Windows installer" → ultimo run verde del ramo `granvelo-dev` → scaricare l'artifact e installare ("Windows ha protetto il PC" → Ulteriori informazioni → Esegui comunque).
2. Aprire "lo spettacolo di prova". **Allestimento**: girare il palco (tasto sinistro gira, destro sposta, rotella zoom), provare Pianta e Frontale. Con **Sposta** trascinare una luce in alto dove non c'è un'americana (ne nasce una), vicino a un'americana (si aggancia), a terra; poi Ctrl Z. Con **Orienta** trascinare il punto dove guarda la luce. Con **Scenografia** aggiungere un pezzo, spostarlo, cambiargli colore e misure.
3. In alto a sinistra "Connetti" → "Usa l'uscita simulata" (oppure il cavo vero). **Banco**: muovere i cursori con il mouse e con la rotella, cliccare un valore e digitarlo; selezionare una luce a colori e usare il selettore colore; guardare la vista frontale cambiare. Muovere un gruppo e il Grand Master.
4. Cliccare una memoria nell'elenco (va in scena), cambiare un cursore: compare "modificata, non salvata"; provare Ripristina, Salva, Salva come nuova.
5. **Blind**: Ctrl+clic su una memoria che non è in scena, poi Ctrl B: fascia blu; muovere i cursori (con il cavo vero le luci non devono cambiare); Esc.
6. Resta da fare la **prova del cavo** descritta in 10 ("Come provare la 0.2.0"), che vale uguale con la 0.4.0.
7. Annotare ciò che non è chiaro a prima vista: parole, dimensioni dei cursori, posizione dei comandi.
