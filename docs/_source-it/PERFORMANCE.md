# Performance del game server: cosa è emulazione, cosa è nativo, cosa si può migliorare

Analisi iniziata il 2026-07-15 di come ASA gira sull'host e di quali componenti
"emulati" pesano davvero sulle risorse, con l'obiettivo di **ridurre CPU/RAM
richiesti e rendere l'esecuzione più fluida**, senza toccare la stabilità
guadagnata durante la validazione Docker (vedi
[`DEPLOYMENT-STATUS.md`](./DEPLOYMENT-STATUS.md)). Per questo si distingue
sempre tra "applicato" e "da testare
prima di toccare `arksa-game`".

## Il vincolo che non si può aggirare

ASA **non ha un dedicated server nativo Linux** e, a differenza del vecchio
ARK: Survival Evolved, **non ha nemmeno una vera modalità headless/`-nullrhi`**:
il log di crash già raccolto mostra che l'exe carica comunque `d3d12.dll` /
`dxgi.dll` / `vkd3d` e richiede un ICD Vulkan funzionante per superare l'avvio,
anche in modalità dedicated senza alcun client collegato. La community (vedi
fonti in fondo) conferma lo stesso vincolo: i pochi tentativi di girare ASA
senza un ICD Vulkan software (lavapipe/llvmpipe) falliscono all'avvio.

Conseguenza: **Wine/Proton e il rasterizzatore software Vulkan non sono
eliminabili**, sono un requisito reale del binario, non una scelta pigra del
setup attuale. Il margine di miglioramento non sta nel "toglierli" ma nel
**impedire che consumino risorse per un output che nessuno vedrà mai**.

## Cosa è stato applicato

Il codice è nel repo (`docker/game-server/launch.sh`, `game-server.env.example`,
`game-server.compose.yml`) e viene usato direttamente dalla produzione Docker
`arksa-game`. Un redeploy pulito usa automaticamente lo stesso tuning via
`launch.sh`.

| Cambiamento | Perché | Rischio |
|---|---|---|
| `LP_NUM_THREADS=1` | lavapipe (rasterizzatore software Vulkan) usa **di default un worker thread per ogni core della VM**, anche per un "rendering" che non produce mai un frame visibile. Su una VM a 4 OCPU questo significa fino a 4 thread che si contendono la CPU con l'unico thread di gameplay di ASA (che, per design del gioco, è prevalentemente single-thread). Limitarlo a 1 lascia i core liberi per ASA. | Bassissimo: variabile Mesa standard, letta anche da Lavapipe (`docs.mesa3d.org/envvars.html`). |
| `WINEDEBUG=-all` | Wine logga di default i canali `fixme`/`warn` su stderr: puro overhead di formattazione stringhe/syscall su un processo headless il cui log nessuno consulta in tempo reale. | Nullo: disabilita solo logging diagnostico, non hook funzionali. |
| `PROTON_NO_FSYNC=0`, `PROTON_NO_ESYNC=0` | Verificato nel sorgente ufficiale di Proton (`ValveSoftware/Proton`, branch `proton_9.0`, file `proton`): fsync/esync sono **già abilitati di default** quando il kernel li supporta (>=5.16, presente su Ubuntu OCI). Impostarli esplicitamente non cambia il comportamento attuale ma blinda il comportamento da eventuali cambi di default nelle prossime GE-Proton. | Nullo: rende esplicito un default già attivo. |
| `PROTON_USE_XALIA=0` | Xalia è il demone di accessibilità di Proton (hook per screen reader/input). Nel sorgente ufficiale si attiva solo se l'appid ha `xalia` nel compat_config di Steam — scenario che non si verifica nel nostro avvio diretto via `proton run` (non passiamo per il client Steam) — ma impostarlo esplicitamente evita che si attivi in futuro. | Nullo: nessun beneficio funzionale, solo difensivo. |
| `-nosound` sul comando ASA | Flag **ufficiale e documentato** su ark.wiki.gg/wiki/Server_configuration: disattiva l'inizializzazione del sottosistema audio. Su un server dietro Wine questo evita di caricare il driver audio (ALSA/Pulse "dummy") emulato via Wine per un processo che non emette mai suono. | Basso: flag ufficiale Wildcard, non un "mito da forum". |

## Ottimizzazione del ciclo on-demand (2026-08-28)

Il percorso di accensione conserva tutti i controlli ma sposta o elimina lavoro
ridondante:

- il check SteamCMD del primo lancio parte appena l'agent espone `/health` e si
  sovrappone al boot-sync/configurazione; il provisioning attende la stessa
  Promise e i lanci successivi eseguono ancora un check nuovo;
- l'ownership ricorsiva del volume viene corretta solo se la root di `/data`
  non appartiene a `steam`, cioè al primo uso/import, anziché scandire gioco,
  mod, prefix e save a ogni container start;
- il template cloud-init usa `compose stop` per conservare container e rete fra
  due power cycle sui nuovi host. Un'immagine o compose nuovi causano comunque
  la ricreazione automatica con `up -d`; l'unità live preesistente va aggiornata
  separatamente perché Terraform ne ignora i metadata storici;
- il boot volume passa elasticamente da Balanced 10 VPU/GB a Higher Performance
  20 VPU/GB prima dello START e torna a 10 allo shutdown. Per il volume live da
  130 GB i limiti nominali OCI salgono da 7.800 a 9.750 IOPS e da 62,4 a
  78 MB/s. Non è un'accelerazione garantita del 25%: aiuta solo le fasi realmente
  I/O-bound, mentre il caricamento UE/ASA resta in parte CPU-bound.

La scelta del tier 20 è supportata anche da telemetria, non solo dai limiti
teorici: il 2026-08-28, sul volume live ancora a 10 VPU/GB, OCI Monitoring ha
registrato picchi di `VolumeThrottledIOs` pari a 7.299 operazioni/minuto e
throughput al limite garantito di 60,9375 MiB/s durante la finestra osservata.
Esiste quindi carico reale che può beneficiare del margine aggiuntivo.

Non sono stati ridotti l'attesa RCON, il controllo mod, gli hook post-SteamCMD,
il `saveworld` né i 15 secondi di assestamento del database RBF già verificati
contro la corruzione. Nessun flag modifica grafica o gameplay dei client.

Tutti i valori restano overridabili da `game-server.env` per test A/B, senza
dover ricostruire l'immagine.

## Cosa è già corretto (verificato, nessun cambiamento necessario)

- **Cache shader (DXVK/VKD3D) e Wine prefix già persistenti**: `STEAM_COMPAT_DATA_PATH=/data/proton-prefix`
  e `ARK_INSTALL_DIR=/data/ark` sono entrambi sul volume persistente `/data`,
  quindi le cache di compilazione shader **non vengono ricreate da zero a ogni
  accensione** — punto potenzialmente critico per un'architettura on-demand
  che spegne/accende spesso, ma già gestito correttamente dal layout esistente.
- **fsync/esync**: già attivi di default (vedi tabella sopra).
- **`WINE_CPU_TOPOLOGY`**: nel sorgente ufficiale viene sovrascritto solo per
  un elenco fisso di appid noti per bug di topologia; ASA non ne fa parte,
  quindi Wine espone di default la topologia reale della VM al gioco — nessun
  intervento necessario.

## Testato e scartato

1. **`-d3d11`/`-sm5` per forzare DirectX 11 invece di DX12 — testato il
   2026-07-15, NESSUN EFFETTO, flag rimosso.** Applicato a mano nell'`ExecStart`
   di `ark-astraeos.service` (nessuna opzione dedicata in `manage.py
   get-configs`), istanza accesa appositamente. **Boot pulito**: Full Startup
   113.11s (baseline 111.31s), *"Server has completed startup and is now
   advertising for join"*, RCON reattivo, CPU/RAM a regime in linea con la
   baseline (idle ~2.4%/4 OCPU, RAM ~17.9GB). **Ma il flag è stato ignorato
   silenziosamente dal motore**: verificato via `/proc/<pid>/maps` su tutti i
   processi del cgroup del servizio — solo `d3d12.dll` risulta caricato (mai
   `d3d11.dll`), quindi il percorso di traduzione resta **vkd3d-proton**, non
   passa a DXVK. Conferma dal vivo l'avvertimento della community citato sotto
   ("molti flag storici vengono ignorati silenziosamente da ASA"). **Rollback
   eseguito** (unit file ripristinata dal backup, verificata identica byte per
   byte) perché tenere un flag no-op in produzione non porta beneficio e
   rischia di confondere debug futuri. Non riprovare senza una nuova fonte che
   indichi un modo diverso per forzare DXVK (es. variabile d'ambiente DXVK
   invece del flag CLI).

## Cosa NON è stato toccato (a rischio, richiede test prima di produzione)

La cronaca del blocco Proton (giorni di debug per l'exit code 21) impone
cautela: qualunque cambiamento allo stack Wine/Proton/Vulkan va **testato su
`arksa-game` prima di considerarlo definitivo**, non applicato "a freddo" solo
sulla base di documentazione.

1. **Priorità di processo (`nice` negativo) e CPU affinity/pinning.** Fonti
   della community concordano: *"real performance gains come from CPU
   affinity, not launch flags"* — cioè i guadagni concreti vengono più da
   scheduling/affinità che dai flag CLI "magici" circolati nei forum. Per
   alzare la priorità serve la capability `SYS_NICE` (vedi riga commentata in
   `game-server.compose.yml`); l'effetto va misurato (RCON `GetGameLog`/tick
   time) prima di renderlo default, perché la VM ha solo 4 OCPU e pinnare male
   può peggiorare le cose invece di migliorarle.
2. **Flag "storici" tipo `-structurememopts`, `-UseStructureStasisGrid`,
   `-nomansky`, `-nomemorybias`, `-UseLargePages`, `-NoHangDetection`.**
   Presenti sul wiki ufficiale (che copre sia ASE che ASA) o su guide di
   hosting, ma la community ASA più aggiornata avverte esplicitamente che
   *molti flag storici da ASE vengono ignorati silenziosamente da ASA o sono
   stati rinominati* — includerli senza verifica nel log di avvio (`ShooterGame.log`,
   sezione command line effettiva) rischia di dare falsa sicurezza. **Il caso
   `-d3d11` sopra è un esempio concreto proprio di questo fenomeno.** Da
   validare uno per uno, non da adottare in blocco.
3. **Transparent Huge Pages a `always`.** Ubuntu di default usa `madvise`
   (già ragionevole per un singolo processo con working set grande come ASA,
   10+ GB). Passare a `always` è un tuning **a livello host** (fuori dal
   container), con guadagni tipicamente marginali (pochi punti percentuali) e
   un rischio noto di micro-stall da compattazione di memoria; non ne vale la
   pena senza un benchmark che lo giustifichi su questo carico specifico.

## Applicazione alla produzione corrente (`arksa-game`)

Dal 2026-08-24 il game server usa l'immagine Docker del repo: `launch.sh`
applica direttamente `LP_NUM_THREADS`, `WINEDEBUG`, fsync/esync, Xalia e
`-nosound`. I tre avvii reali Astraeos del cutover non hanno mostrato
regressioni; dettagli e tempi in `DEPLOYMENT-STATUS.md`.

## Fonti

- [ValveSoftware/Proton — sorgente ufficiale `proton` (branch `proton_9.0`)](https://raw.githubusercontent.com/ValveSoftware/Proton/proton_9.0/proton) — verifica diretta di `PROTON_NO_ESYNC`, `PROTON_NO_FSYNC`, `PROTON_USE_XALIA`, `WINE_CPU_TOPOLOGY`, `PROTON_FORCE_LARGE_ADDRESS_AWARE` e relativi default.
- [ARK Official Community Wiki — Server configuration](https://ark.wiki.gg/wiki/Server_configuration) — elenco flag ufficiali (`-nosound`, `-d3d11`, `-structurememopts`, ecc.).
- [Mesa 3D — Environment Variables (LP_NUM_THREADS)](https://docs.mesa3d.org/envvars.html)
- [OCI — Block Volume Performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm)
- [OCI — Changing Boot Volume Performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/update-performance-boot-bv-volume.htm)
- [Docker Compose — `pull_policy` e ciclo dei servizi](https://docs.docker.com/reference/compose-file/services/)
- [ProtonDB — Improving Performance](https://www.protondb.com/help/improving-performance)
- Discussione Steam Community sulle launch options ASA (flag client vs server, cautela su flag "da forum" non honored dal motore).
- [`docs/DEPLOYMENT-STATUS.md`](./DEPLOYMENT-STATUS.md) — runtime e stato live validati.
