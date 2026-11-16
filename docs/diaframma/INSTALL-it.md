# Diaframma — installazione e prima prova

## Scaricare l'installer
1. Apri https://github.com/tommi-tr/theatre-suite/releases e scegli l'ultimo rilascio che comincia con `diaframma-v`.
2. In fondo alla pagina, sotto **Assets**, clicca `Diaframma_<versione>_x64-setup.exe`: l'installer si scarica.
   (In alternativa: Theatre Suite, il launcher, scarica e installa le app da solo.)

## Installare
1. Doppio clic su `Diaframma_<versione>_x64-setup.exe`.
2. L'installer non è ancora firmato digitalmente, quindi Windows può mostrare **"Windows ha protetto il PC"**:
   clicca **Ulteriori informazioni** → **Esegui comunque**.
3. Non servono diritti di amministratore: Diaframma si installa solo per il tuo utente
   (in `%LOCALAPPDATA%\Diaframma`) e crea un collegamento nel menu Start.
4. Su Windows 10 senza WebView2 l'installer lo scarica (serve internet solo questa volta).

## Disinstallare
Impostazioni di Windows → App → Diaframma → Disinstalla. I tuoi file `.diaframma` e i file audio
non vengono toccati. La casella "elimina i dati dell'app" (spenta di default) cancella anche
impostazioni e salvataggi automatici.

## Dove salva i dati
`%APPDATA%\it.theatresuite.diaframma\`: impostazioni, salvataggio automatico, registro delle modifiche
della modalità Prove. Diaframma non scrive da nessun'altra parte, tranne dove salvi tu le scalette.

## Estensione per Chrome (facoltativa)
1. Dalla stessa pagina di GitHub scarica **Diaframma-Chrome-extension** e scompatta lo zip.
2. In Chrome apri `chrome://extensions`, attiva **Modalità sviluppatore**, clicca **Carica estensione non pacchettizzata**
   e scegli la cartella scompattata.
3. In Diaframma: Impostazioni → Connessioni → **Estensione per Chrome**.

## Telefono (facoltativo)
Pulsante **Telefono** in alto → accendi → inquadra il QR con un telefono sullo stesso Wi-Fi.
La prima volta Windows chiede il permesso del firewall: scegli **Reti private** e **Consenti**.
