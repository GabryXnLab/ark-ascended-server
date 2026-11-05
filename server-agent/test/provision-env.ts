// Import per primo in provision.test.ts: isola i path scritti dal provisioning
// (attivi anche in mock, vedi ini.ts/maps.ts che non hanno un branch mock) in una
// cartella temporanea dedicata, distinta da quella usata da ini.test.ts.

import os from "node:os";
import path from "node:path";

process.env.AGENT_MODE = "mock";
process.env.ARK_INSTALL_DIR = path.join(os.tmpdir(), `arksa-provision-install-${process.pid}`);
process.env.ARK_MAPS_DIR = path.join(os.tmpdir(), `arksa-provision-maps-${process.pid}`);
process.env.ARK_ACTIVE_MAP_FILE = path.join(os.tmpdir(), `arksa-provision-active-map-${process.pid}`);
process.env.ARK_ACTIVE_PROFILE_FILE = path.join(os.tmpdir(), `arksa-provision-active-profile-${process.pid}`);
process.env.ARK_ACTIVE_CONFIG_FILE = path.join(os.tmpdir(), `arksa-provision-active-config-${process.pid}.json`);
process.env.ARK_MOD_VERSIONS_FILE = path.join(os.tmpdir(), `arksa-provision-mod-versions-${process.pid}.json`);
process.env.ARK_ACTIVE_MODS_FILE = path.join(os.tmpdir(), `arksa-provision-active-mods-${process.pid}`);
process.env.ARK_GUS_INI = path.join(os.tmpdir(), `arksa-provision-gus-${process.pid}.ini`);
process.env.ARK_GAME_INI = path.join(os.tmpdir(), `arksa-provision-game-${process.pid}.ini`);
process.env.ARK_LAUNCH_ARGS_FILE = path.join(os.tmpdir(), `arksa-provision-launch-args-${process.pid}`);
