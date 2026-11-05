// Import per primo nei test che toccano `config`: imposta l'ambiente prima
// che qualunque modulo legga process.env in fase di inizializzazione.

import os from "node:os";
import path from "node:path";

process.env.AGENT_MODE = "mock";
process.env.ARK_PLAYTIME_LOG_FILE = path.join(os.tmpdir(), `arksa-playtime-test-${process.pid}.jsonl`);
process.env.ARK_GUS_INI = path.join(os.tmpdir(), `arksa-gus-test-${process.pid}.ini`);
process.env.ARK_GAME_INI = path.join(os.tmpdir(), `arksa-game-test-${process.pid}.ini`);
process.env.ARK_LAUNCH_ARGS_FILE = path.join(os.tmpdir(), `arksa-launch-args-test-${process.pid}`);
process.env.ARK_ALLOWED_CHEATER_ACCOUNTS_FILE = path.join(os.tmpdir(), `arksa-admin-whitelist-test-${process.pid}.txt`);
process.env.RCON_PASSWORD = "admin-runtime-test";
