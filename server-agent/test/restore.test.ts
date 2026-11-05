// restoreSave in modalità "live" fa un vero giro OCI (niente mock lato client, vedi
// oci-client.ts): la logica di archivio è coperta da save-archive.test.ts, qui si
// fissa il layout del volume Docker rispetto ad arkInstallDir.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { config } from "../src/config.js";
import { savedRootDir } from "../src/restore.js";

test("savedRootDir deriva da config.arkInstallDir", () => {
  assert.equal(savedRootDir(), path.join(config.arkInstallDir, "ShooterGame", "Saved"));
});
