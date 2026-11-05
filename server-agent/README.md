# server-agent

Agent locale che gira **sul game server** (VM x86). Espone un'API HTTP usata
**solo dal control plane** (rete VCN, porta `8787`, token condiviso) per:

- leggere **metriche** host (CPU/RAM/disco/uptime);
- leggere lo **stato ARK** via RCON (online, mappa, giocatori);
- **avviare/fermare** il singolo processo ARK/Proton nel container;
- gestire **profili-mappa**, **mod** (`-mods=`), parametri **.ini** e
  argomenti ASA avanzati per profilo;
- materializzare la whitelist globale degli amministratori EOS/ARK nel file
  nativo `AllowedCheaterAccountIDs.txt` e servirla ad ASA su un endpoint
  testuale accessibile senza token soltanto da loopback;
- eseguire l'**auto-stop**: con 0 giocatori oltre il timer fa `saveworld`, ferma
  ARK e **arresta l'istanza** via instance principal (`oci ... action STOP`).

Stack: Node + TypeScript + Express. Nessuna dipendenza superflua: il client
**RCON** è implementato a mano (protocollo Source su TCP).

## Sviluppo (modalità mock)

In `AGENT_MODE=mock` non tocca systemd/RCON/OCI reali: tiene uno stato in
memoria, ideale per testare il backend/PWA in locale.

```bash
npm install
cp .env.example .env        # AGENT_MODE=mock di default
npm run dev                 # tsx watch
# oppure: npm run typecheck && npm test
```

Esempi:

```bash
curl localhost:8787/health
curl localhost:8787/ark/status
curl -XPOST localhost:8787/map/switch -H 'content-type: application/json' -d '{"id":"astraeos"}'
```

## Produzione

`AGENT_MODE=live` + `.env` con percorsi reali, `AGENT_TOKEN`, `RCON_PASSWORD` e
`OCI_AUTH=instance_principal`. L'agent gira nel container avviato da
`arksa-game-server.service`; ARK è invece un processo figlio diretto controllato
dall'agent. L'OCID dell'istanza si legge dai metadata se `OCI_INSTANCE_OCID` non
è impostato.

L'applicazione di una configurazione sostituisce il blocco gestito dei due INI,
scrive le direttive avanzate e `/data/arksa-launch-args`, quindi avvia ASA e
attende RCON-online. Il sidecar `*.arksa-managed.json` consente di rimuovere i
valori del profilo precedente anche quando ASA riscrive i file eliminando i
commenti-marker. Solo dopo RCON-online l'agent salva id e revisione effettivi in
`/data/active-configuration.json`. Richieste concorrenti diverse vengono eseguite
in FIFO, mai ignorate o sovrapposte; i duplicati identici vengono riuniti.

Prima di ogni avvio del processo, SteamCMD verifica ASA e le mappe ufficiali.
Se un vecchio depot manifest non è più scaricabile e SteamCMD resta in stato
`0x6`, dopo due tentativi l'agent isola il solo `appmanifest` locale e la
directory di staging dell'app, quindi usa `validate` per ricostruire i metadati
dai file già presenti. Installazione, configurazioni e salvataggi non vengono
cancellati.
Il control plane invia inoltre l'identificatore dell'ultimo pacchetto CurseForge
`WindowsServer` per ciascun ModID; l'agent confronta `/data/mod-versions.json` e
mantiene lo stato `updating-mods` finché ASA non torna RCON-online. Solo allora
certifica il manifesto, così update interrotti o falliti vengono ritentati.

## API

Endpoint: `/metrics`,
`/ark/status|start|stop`, `/admin-whitelist[.txt]`, `/maps`, `/map/switch|install`,
`/mods`, `/ini`, `/timer`, `/health`.
