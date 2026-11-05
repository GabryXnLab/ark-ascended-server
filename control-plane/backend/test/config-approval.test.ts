import test from "node:test";
import assert from "node:assert/strict";
import { applyPendingRequest, ConfigValidationError } from "../src/routes.js";
import type { PendingRequest } from "../src/requests-store.js";

test("una proposta non valida viene rifiutata all'approvazione come il salvataggio diretto", async () => {
  const request = {
    id: "r1",
    kind: "config",
    status: "pending",
    submittedBy: { id: "u1", name: "Amico" },
    payload: {
      name: "Proposta",
      map: "TheIsland_WP",
      mods: [],
      iniOverrides: {
        gus: { values: { XPMultiplier: "abc" }, sections: {} },
        game: { values: {}, sections: {} },
      },
    },
  } as unknown as PendingRequest;
  await assert.rejects(applyPendingRequest(request), (error: unknown) =>
    error instanceof ConfigValidationError && /Moltiplicatore XP.*numero/.test(error.message));
});
