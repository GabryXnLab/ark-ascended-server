// Import per primo in mods-library.test.ts: imposta l'ambiente prima che
// config.ts legga process.env in fase di inizializzazione (stesso motivo di
// test/env.ts, ma qui serve mode "live" per esercitare la scansione reale del
// filesystem invece dei dati finti di isMock()).

import os from "node:os";
import path from "node:path";

process.env.AGENT_MODE = "live";
process.env.ARK_INSTALL_DIR = path.join(os.tmpdir(), `arksa-mods-test-${process.pid}`);
