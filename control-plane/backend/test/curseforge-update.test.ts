import { test } from "node:test";
import assert from "node:assert/strict";
import { modUpdateVersion } from "../src/curseforge.js";

test("sceglie il pacchetto WindowsServer più recente per il controllo versione", () => {
  assert.deepEqual(modUpdateVersion({
    id: 988598,
    dateModified: "2026-08-27T09:00:00Z",
    latestFiles: [
      { id: 1, fileName: "astraeos-windows 9.zip", fileDate: "2026-08-27T11:00:00Z" },
      { id: 2, fileName: "astraeos-windowsserver 8.zip", fileDate: "2026-08-26T10:00:00Z" },
      { id: 3, fileName: "astraeos-windowsserver 9.zip", fileDate: "2026-08-27T10:00:00Z" },
    ],
  }), { id: 988598, version: "file:3:2026-08-27T10:00:00Z" });
});

