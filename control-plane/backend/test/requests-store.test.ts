import { after, test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const tmpDir = path.join(os.tmpdir(), `arksa-requests-store-${process.pid}`);
process.env.REQUESTS_DATA_FILE = path.join(tmpDir, "pending-requests.json");

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("scarta le proposte ritirate e conserva le revisioni configurazione", async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  const submittedBy = { id: "u", name: "Utente" };
  await fs.writeFile(process.env.REQUESTS_DATA_FILE!, JSON.stringify([
    { id: "old-ini", kind: "ini", submittedBy, submittedAt: "2026-07-01T00:00:00.000Z", status: "pending", payload: {} },
    { id: "old-delete", kind: "deleteConfig", submittedBy, submittedAt: "2026-07-02T00:00:00.000Z", status: "pending", payload: { id: "x" } },
    { id: "cfg", kind: "config", submittedBy, submittedAt: "2026-07-03T00:00:00.000Z", status: "rejected", payload: { name: "A", map: "TheIsland_WP", mods: [], iniOverrides: {} } },
  ]));
  const store = await import("../src/requests-store.js");
  assert.deepEqual((await store.listRequests()).map((request) => request.id), ["cfg"]);
  assert.equal(await store.getRequest("old-ini"), undefined);
});
