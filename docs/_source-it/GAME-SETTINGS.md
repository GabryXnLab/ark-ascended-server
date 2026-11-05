# Catalogo impostazioni ASA

La PWA espone 422 opzioni scalari di ARK: Survival Ascended: 145 booleane,
185 float, 74 intere, 15 stringhe e 3 password. Due password sono modificabili
per profilo; `ServerAdminPassword`, `AdminListURL`,
`UpdateAllowedCheatersInterval` e `RCONPort` restano visibili nel catalogo ma
sono protette e gestite esclusivamente dall'infrastruttura. Struct, array,
direttive ripetute e configurazioni delle mod restano nell'editor INI avanzato.

## Navigazione nell'editor

Il catalogo tecnico resta unico, ma la PWA ricompone i campi in 18 categorie
vicine alle sezioni del menu host di ARK: generale, tassi e difficoltà,
giocatore, creature e taming, allevamento, statistiche per livello, raccolta,
oggetti/crafting/loot, strutture, PvE/PvP/tribù, mondo, trasferimenti, interfaccia,
cryopod, mappe, regole, amministrazione e avvio.

Ogni campo finale possiede almeno un tag normalizzato; il vocabolario corrente
comprende 44 temi trasversali, tra cui accoppiamento, crescita cuccioli,
imprinting, dino selvatici/addomesticati, giocatore, raccolta, strutture, raid,
tribù, trasferimenti, HUD e sicurezza. I tag sono inferiti dal testo del campo e
corretti a mano, chiave per chiave, dove l'euristica sbaglia
(`TAG_OVERRIDES` in `gameSettingsTaxonomy.ts`: per esempio `ServerPlatform` non è
una struttura e `BanListURL` non riguarda il tempo). La ricerca indicizza chiave
INI, etichetta, descrizione, categoria e nome italiano dei tag. Categoria, tag,
testo e filtro “solo modificate” sono combinabili e mostrano i conteggi dei
risultati senza cambiare la serializzazione del profilo.

Un campo è “modificato” solo se ha un valore diverso dal default ASA (confronto
numerico per int e float); i campi infrastrutturali e quelli lasciati uguali al
default non contano. Il riepilogo mostra il totale delle modificate più le
direttive avanzate e gli argomenti di avvio non vuoti. “Copia categoria”
ricontrolla ogni valore copiato con le regole del salvataggio e scarta,
segnalandoli, quelli non validi o fuori intervallo.

Quasi tutti i campi hanno una descrizione italiana breve: 146 provengono da
`gameSettingHelp.ts` e sono limitati alle opzioni il cui significato è noto dalla
documentazione ASA. Ne restano 12 senza testo (varianti di wireless crafting,
limiti degli avamposti, `OutpostSigilRewardMultiplier` e simili) perché il significato non è verificabile: meglio nessun testo che uno
inventato. Il testo di riserva non cambia i tag inferiti.

`MultiHome` ed `ExclusiveJoin` restano nel catalogo ma compaiono nell'editor solo
nei profili che li hanno già valorizzati (`legacy: true`): in un container con
una sola interfaccia `MultiHome` non serve e il launcher non ne passa l'indirizzo;
`ExclusiveJoin` (`-exclusivejoin`) è equivalente a `UseExclusiveList`.

## Default mostrati

Il catalogo associa a ogni chiave un `defaultValue`. Il placeholder non è testo
di esempio: viene derivato da quel valore, così lasciare vuoto un campo mostra
esattamente ciò che ASA userà senza override. Anche il menu booleano specifica
se il default è attivo o disattivo.

I valori sono stati verificati il 2026-08-25 confrontando la
[ARK Official Community Wiki](https://ark.wiki.gg/wiki/Server_configuration)
con la [baseline ASA in formato INI](https://github.com/Arkobat/ArkServerSettings/tree/master/SurvivalAscended/Default).
I valori indicizzati delle statistiche usano le tabelle `PerLevelStatsMultiplier`,
`PlayerBaseStatMultipliers` e `MutagenLevelBoost` della stessa pagina ufficiale.

Dodici chiavi non hanno un default fisso documentato da Wildcard e mostrano
quindi `(non impostato)`: `MultiHome`, gli override XP massimi, i due limiti
alleanze, `ExcludeItemIndices`, `ValgueroMemorialEntries`, i tre limiti degli
outpost, `AdminListURL` e `AutoRestartIntervalSeconds`. `AdminListURL` è però
materializzata soltanto nel runtime ARKSA; per i campi numerici modificabili di
questo gruppo lo slider resta disabilitato finché non viene digitato un valore.

Tre default sono quelli effettivi del launcher del progetto, perché vengono
sempre materializzati sulla riga di comando anche se assenti dal profilo:
`SessionName=ARK On-Demand`, `MaxPlayers=20` e `ServerPlatform=ALL`.

## Credenziale amministratore e RCON

RCON è sempre attivo: il launcher passa `?RCONEnabled=True` sull'URL di avvio
perché l'agent ne ha bisogno per stato, salvataggi e spegnimento automatico.
`RCONEnabled` non è nel catalogo; i profili storici che la contengono fra i
valori scalari restano salvabili (`OBSOLETE_INFRASTRUCTURE_GUS_KEY_NAMES`) e
l'agent la scarta prima di scrivere l'INI.

`RCONPort` è infrastrutturale come la password: launcher e agent usano la porta
dell'env `RCON_PORT` (27020 di default) e ignorano quella dell'INI, così un
profilo non può spezzare stato, salvataggi e spegnimento automatico né collidere
con le porte di gioco (7777, 27015) o dell'agent. Il backend e l'agent rifiutano
`RCONPort` in valori e raw, `readIni` la nasconde e il launcher/l'agent
riallineano la riga nell'INI.

`ServerAdminPassword` non segue la semantica dei normali default ASA: il
launcher la materializza sempre usando `RCON_PASSWORD`, lo stesso segreto usato
dall'agent. Tenerla fuori dai profili evita che `GET /configs`, le copie fra
configurazioni o le proposte degli amici distribuiscano una credenziale capace
di eseguire comandi amministrativi. Backend e agent rifiutano anche tentativi
diretti via valori scalari o editor INI avanzato.

Il segreto viene generato da Terraform; state ed env `0600` dell'host sono le
fonti autorevoli. ASA può ripersistirne una copia nel proprio INI runtime sul
volume protetto: il launcher la sovrascrive dall'env prima di ogni avvio;
l'agent la risincronizza dopo RCON-online e dopo lo stop, forza l'INI a `0600`
e la oscura nelle letture API. L'amministratore la recupera con
`terraform -chdir=terraform output -raw rcon_password`. In gioco si usa prima
`enablecheats <password>`, poi il comando con prefisso `cheat` o `admincheat`.

Per evitare l'inserimento della password da controller, il pannello
**Opzioni → Amministrazione → Admin ARK** gestisce invece la whitelist ufficiale
ASA. Accetta EOS/ARK account ID alfanumerici di 32 caratteri, può proporre con
un tap i giocatori online rilevati da RCON e scrive un ID per riga in
`ShooterGame/Saved/AllowedCheaterAccountIDs.txt`. L'agent espone lo stesso
contenuto ad ASA come testo semplice su un endpoint accessibile senza token
soltanto da `127.0.0.1`; dalla VCN resta protetto da `AGENT_TOKEN`. Il launcher
forza `AdminListURL` verso tale endpoint e
`UpdateAllowedCheatersInterval=5`. Queste due direttive sono infrastrutturali e
non possono essere sostituite dai profili. Gli account presenti sono già
autenticati come amministratori e usano direttamente i prefissi `cheat` o
`admincheat`. La lista è globale, admin-only e non viene inclusa nei profili o
nelle proposte dei membri.

Se il game server è spento, il control plane persiste la nuova lista e la
inserisce con priorità nella boot queue, prima dell'eventuale configurazione che
avvia ASA. A server online il file viene sostituito atomicamente e ASA rilegge
l'`AdminListURL` locale entro 5 secondi. L'autorizzazione viene assegnata alla
connessione del giocatore: dopo l'aggiunta è quindi necessario uscire e
rientrare nel server, ma non riavviare ASA. Il file locale da solo viene letto
all'avvio e non va confuso con il polling di `AdminListURL`.

## Intervalli numerici

Ogni campo numerico dichiara `min` e `step`; `max` è il limite di validazione.
I limiti naturali restano specifici della grandezza (per esempio porte 1–65535,
orari 0–86400, percentuali normalizzate 0–1, `MaxPlayers` 1–200).

I moltiplicatori (le chiavi `*Multiplier*`) e `OverrideOfficialDifficulty` non
hanno limite superiore di validazione: devono solo essere numeri finiti e non
inferiori a `min`. I server privati usano spesso valori ben oltre il profilo
ufficiale (taming x85, crescita cuccioli x50000) e le configurazioni di
produzione ne contengono. Per questi campi il profilo 0–6 dell'interfaccia host
di ARK vale solo come `sliderMax`, cioè come estremo del cursore: l'input
numerico accanto accetta valori più alti, li allinea al passo senza riportarli
a 6 e segnala sotto il campo che il valore è oltre il cursore. Non serve quindi
l'editor INI avanzato, che anzi rifiuta i campi del catalogo.

Per i campi con limite superiore slider e input ricevono gli stessi estremi. Le
frecce del campo rispettano il range e un valore digitato fuori intervallo viene
riportato all'estremo più vicino quando il campo perde il focus; un valore
intermedio viene allineato al passo previsto (`snapTypedValue`). Il pulsante di
reset rimuove l'override e torna al default mostrato, senza scriverlo nel file.

La griglia del passo è ancorata a zero (multipli di `step`), non a `min`: con un
minimo non multiplo del passo (per esempio `min 1`, passo 60) l'ancoraggio a `min`
trasformava il default 3600 in 3601. Gli estremi effettivi di slider e input sono
il primo e l'ultimo punto di griglia nell'intervallo. Un default fuori griglia e un
focus/blur senza modifiche non vengono mai riscritti. La funzione è in
`numberSnap.ts`, testata da `server-agent/test/number-snap.test.ts`.

I moltiplicatori float hanno passo fine: 0.05 (0.1 per difficoltà ufficiale e
batterie Tek), così 0.5, 1.5 e 2.5 sono digitabili. Se il default ASA non cade
sulla griglia (0.14, 0.44, 0.17 nelle statistiche per livello) il passo scende a
0.01, perché il default deve restare raggiungibile.

Su dispositivi touch il valore dello slider viene preparato localmente e
salvato solo quando il gesto supera una soglia ed è chiaramente orizzontale. Un
movimento verticale continua quindi a scorrere l'elenco senza cambiare il
profilo. La rotellina fa perdere il focus agli input numerici prima che il
browser possa applicare uno step; mouse, tastiera e inserimento preciso restano
disponibili.

## Validazione e regole condivise

Le regole di validazione vivono in un unico modulo puro,
`control-plane/pwa/src/configRules.ts`: chiavi e sezioni INI valide, valori senza
nuove righe, chiavi infrastrutturali, marker interni, raw che duplica un campo
grafico (confronto per sezione effettiva: `Duration` di una mod in `[ModX]` non è
la durata del messaggio del giorno), argomenti CLI riservati e, con il catalogo,
tipi, intervalli, sezione corretta, `managedKeys` note, chiavi di catalogo
inserite nel raw invece che nei campi strutturati, `ServerPlatform` e formato di
stringhe e URL.

Backend e agent hanno build Docker separate e non possono importare dalla PWA:
ricevono una copia generata (`control-plane/backend/src/shared/`,
`server-agent/src/shared/`, più il catalogo in forma di tabella) da
`scripts/sync-config-rules.mts`. Dopo aver modificato `configRules.ts` o il
catalogo, dalla cartella `server-agent`:

```
node --import tsx ../scripts/sync-config-rules.mts          # riscrive le copie
node --import tsx ../scripts/sync-config-rules.mts --check  # verifica, exit 1 se divergono
```

Un test dell'agent (`config-rules-sync.test.ts`) fallisce se le copie non sono
allineate e verifica che la configurazione costruita dal catalogo con i default
ASA superi la validazione.

Dove gira:

- **PWA**: `ConfigEditor` valida prima di inviare e mostra l'errore in pagina.
- **Backend**: `POST /configs` risponde 400 con un messaggio italiano (massimo
  cinque errori) prima di salvare o di accodare una proposta; prima l'errore
  compariva solo come stage `error` del provisioning, dopo che la configurazione
  era già stata marcata applicata. Il modulo è `config-validation.ts`.
- **Agent**: al provisioning applica solo il sottoinsieme strutturale (senza
  catalogo), così i profili già salvati restano avviabili.

Le chiavi spostate di file dal catalogo (`ImplantSuicideCD` in
`GameUserSettings.ini`, `IgnorePVPMountedWeaponryRestrictions` in `Game.ini`,
perché ASA la legge da lì) sono migrate dall'agent, in modo trasparente, nei
profili salvati con la posizione vecchia (`migrateLegacyKeyLocations`); la
validazione accetta la posizione vecchia.

## Stringhe e URL di avvio

`SessionName`, `ServerPassword` e `SpectatorPassword` finiscono nell'URL di avvio
(`?SessionName=…?ServerPassword=…`), dove `?` e le virgolette troncano le altre
opzioni. La validazione li rifiuta (le password anche con spazi), rifiuta gli spazi
ai bordi e limita a 128 caratteri; la PWA toglie gli spazi ai bordi delle stringhe.
`launch.sh` sostituisce con spazi i caratteri proibiti nel nome sessione e si
rifiuta di avviare con una `ServerPassword` inutilizzabile, invece di avviare un
server pubblico senza dirlo.

`BanListURL` è validata come indirizzo http(s) e scritta dall'agent fra virgolette
(l'utente inserisce solo l'indirizzo; un valore già quotato non viene raddoppiato).
Gli altri URL sono validati ma scritti così come sono. `ServerPlatform` è un menu
con `ALL` e le combinazioni di `PC`, `XSX`, `PS5` e `WINGDK` separate da `+` (l'ordine
è quello della documentazione, per esempio `PC+XSX+PS5`); qualsiasi altro valore è
rifiutato perché un refuso rende il server invisibile. `ClusterId`,
`ClusterDirOverride` e `MultiHome` hanno un formato minimo (niente spazi né
virgolette; IP per MultiHome).

Gli argomenti CLI riservati comprendono anche i parametri dell'URL di avvio
(`-QueryPort`, `-AltSaveDirectoryName`, `-ServerAdminPassword`, `-ServerPassword`,
`-SpectatorPassword`, `-SessionName`, `-MaxPlayers`, `-RCONPort`, `-RCONEnabled`):
il nome termina al primo `=` o spazio.

Il launcher legge le chiavi nella sezione scritta dalla PWA (per esempio
`MaxPlayers` in `[ARKSA.Launch]`): l'agent preserva le chiavi omonime di ASA o
delle mod in altre sezioni e la grep per solo nome avrebbe letto quella sbagliata.
ASA ignora `MaxPlayers` in `[/Script/Engine.GameSession]` (vi scrive il proprio
70) e usa `-WinLiveMaxPlayers`, generato dal launcher. I profili salvati con il
catalogo precedente hanno ancora `MaxPlayers` in quella sezione: la validazione
la accetta (`LEGACY_KEY_SECTIONS`) e l'agent, in `migrateLegacyKeyLocations`, la
riscrive in `[ARKSA.Launch]`, così «Genesis 1» resta a 3 posti invece di
ricadere sul default 20.

## Scrittura dell'INI

`replaceManagedIni` rimuove una chiave gestita solo nelle sezioni in cui è nota
(catalogo, sezioni del profilo, sezione effettiva del raw, sidecar): `Message` e
`Duration` di una mod o `MaxPlayers` di `[/Script/Engine.GameSession]` non vengono
cancellati. Il sidecar `*.arksa-managed.json` registra ora anche le sezioni
(`entries`); uno scritto in precedenza, con i soli nomi, continua a ripulire ovunque
una volta sola. INI e sidecar sono scritti in modo atomico (file temporaneo e
rename) conservando i permessi esistenti; un `GameUserSettings.ini` nuovo nasce
`0600`, come lo crea il launcher.

## Visibilità delle password

`ServerPassword` resta visibile a tutti i membri perché serve per entrare.
`SpectatorPassword` dà un accesso privilegiato: `GET /configs` la oscura (nei valori
e nel raw) per chi non è admin e ha accesso “nessuno” alla configurazione; la vede
chi ha accesso di revisione o completo.

## Verifica automatica

Il test di integrazione del catalogo fallisce se una delle 422 chiavi non ha un
default esplicito (anche `null`), se placeholder e default divergono, se manca
un intervallo numerico, se il default cade fuori dallo slider, se un
moltiplicatore ha un limite superiore di validazione o se il suo slider supera 6.

I test verificano inoltre che le 422 chiavi restino uniche, che ogni campo
finale abbia una sola categoria e almeno un tag valido e che le aree principali
separino allevamento, statistiche, cryopod e contenuti delle mappe. Altri test
controllano che ogni default sia sulla griglia del proprio passo, che nessun
moltiplicatore float abbia passo superiore a 0.1, che la baseline delle chiavi
gestite dell'agent sia allineata al file del catalogo e che i tag corretti a mano
non regrediscano.
