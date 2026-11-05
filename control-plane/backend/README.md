# control-plane/backend

Backend del control plane (VM Always Free ARM). Espone l'API consumata dalla PWA
e:

- legge/imposta lo **stato dell'istanza** game server via **OCI SDK** (`oci-core`):
  `START` / `SOFTSTOP` / `getInstance` / IP pubblico;
- fa da **proxy autenticato** verso il `server-agent` (ARK, mappe, mod, ini, timer);
- verifica i JWT Google di **Supabase Auth** e gestisce profili, directory,
  community, membership e richieste di ingresso;
- espone le rotte correnti dietro l'adapter community legacy, senza cambiare i
  file persistenti o il game server;
- persiste notifiche in-app community-scoped per richiesta di accensione e
  server RCON-online, con stato letto personale e monitor indipendente dalla PWA;
- **serve la PWA** buildata (static + SPA fallback).

Stack: Node + TypeScript + Express + `oci-common`/`oci-core`.

## Modalità OCI

| `OCI_MODE` | Uso |
|---|---|
| `mock` | sviluppo locale: simula STOPPED→STARTING→RUNNING, nessuna chiamata OCI |
| `config_file` | usa `~/.oci/config` (dev con credenziali reali) |
| `instance_principal` | produzione: nessuna chiave statica (vedi policy in OCI-SETUP.md §4) |

## Sviluppo

```bash
npm install
cp .env.example .env       # OCI_MODE=mock di default
npm run dev                # tsx watch
# accedi dalla PWA: gli endpoint applicativi richiedono un JWT Supabase
curl localhost:3000/api/health
```

Con l'agent in mock acceso (porta 8787) e `AGENT_URL` puntato ad esso, in mock
OCI lo stato istanza resta simulato: per testare i pass-through ARK conviene
usare `OCI_MODE=config_file` su un'istanza reale, oppure testare l'agent a parte.

## API

La directory usa
`/api/v2`; le API server correnti restano disponibili sotto il prefisso della
community selezionata e, per rollback, su `/api`.
Endpoint: `/status`, `/power/on|off`, `/timer`, `/maps`, `/map/switch|install`,
`/mods`, `/ini`, `/friends`, `/health`. Setup in
[`docs/CONFIGURATION.md`](../../docs/CONFIGURATION.md).
Il namespace v2 aggiunge
`/communities/:id/notifications`, `/notifications/unread-count` e
`/notifications/:notificationId/read`; `POST /notifications/read-all` azzera
anche le non lette oltre la pagina caricata. Le API v1 usano la stessa
membership legacy v2 e non leggono più autorizzazioni parallele.
