# control-plane/pwa

PWA installabile (React + Vite + `vite-plugin-pwa`) per esplorare community e
gestire il relativo server ARK on-demand. UI in italiano, mobile-first; il
polling ogni 5s parte soltanto dopo aver aperto una community con server.

Schermate:
- **Explorer** — ricerca community, richieste di ingresso, creazione senza server.
- **Dashboard** — stato istanza/ARK, risorse (CPU/RAM/disco/uptime), giocatori.
- **Accensione** — comando on/off con conferma di arresto, percentuale per fasi
  e timer auto-stop su inattività.
- **Mappe** — elenco profili, avvio (una alla volta), aggiunta/scarico mappa.
- **Mod & Config** — lista mod e 422 parametri categorizzati e navigabili per tag;
  gli slider touch non cambiano durante lo scroll verticale.
- **Impostazioni** — account Google e indirizzo `IP:7777` da condividere.
- **Amministrazione** — inviti email, permessi e richieste (owner/admin).
- **Notifiche** — feed persistente per accensione e server online, badge non
  lette e avvisi dispositivo opzionali mentre la PWA è in esecuzione.

Il design system usa un tema scuro monocromatico, basato su nero, grigio e
bianco. Verde, ambra e rosso sono riservati agli stati operativi e ai relativi
comandi. L'interfaccia è responsive e rispetta focus visibile, target touch e
`prefers-reduced-motion`.

## Sviluppo

```bash
npm install
npm run dev        # http://localhost:5173 — proxy /api → http://localhost:3000
```

Avvia anche il backend (`control-plane/backend`, `OCI_MODE=mock`) per dati finti.
Google Auth/Supabase devono essere configurati (vedi [`docs/CONFIGURATION.md`](../../docs/CONFIGURATION.md)).

## Build / deploy

```bash
npm run build      # genera dist/ (app + service worker + manifest)
```

Il backend serve `dist/` se `PWA_DIST` punta a questa cartella (vedi cloud-init).

## Note

- L'icona `public/icon.svg` è un segnaposto: sostituiscila con icone PNG
  192/512 per un'installabilità ottimale su tutti i browser.
- Tutte le chiamate applicative passano dal backend (`/api`); nessuna
  credenziale OCI o secret key Supabase raggiunge il client. La sessione e il
  refresh del JWT sono gestiti dall'SDK Supabase.
