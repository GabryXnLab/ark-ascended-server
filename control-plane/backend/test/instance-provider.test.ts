import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstanceProvider } from "../src/config.js";
import { buildPlayerShares } from "../src/playtime-shares.js";

test("senza INSTANCE_PROVIDER deriva da OCI_MODE (retrocompatibile)", () => {
  assert.equal(resolveInstanceProvider({}), "mock");
  assert.equal(resolveInstanceProvider({ OCI_MODE: "mock" }), "mock");
  assert.equal(resolveInstanceProvider({ OCI_MODE: "instance_principal" }), "oci");
  assert.equal(resolveInstanceProvider({ OCI_MODE: "config_file" }), "oci");
});

test("INSTANCE_PROVIDER esplicito prevale su OCI_MODE", () => {
  assert.equal(resolveInstanceProvider({ INSTANCE_PROVIDER: "docker", OCI_MODE: "instance_principal" }), "docker");
  assert.equal(resolveInstanceProvider({ INSTANCE_PROVIDER: "OCI", OCI_MODE: "mock" }), "oci");
  assert.equal(resolveInstanceProvider({ INSTANCE_PROVIDER: "mock" }), "mock");
});

test("provider sconosciuto è un errore", () => {
  assert.throws(() => resolveInstanceProvider({ INSTANCE_PROVIDER: "k8s" }), /non valido/);
});

test("senza costo il riparto ha solo tempi e shareAmount null", () => {
  const players = [
    { id: "a", name: "A", seconds: 300 },
    { id: "b", name: "B", seconds: 100 },
  ];
  const shares = buildPlayerShares(players, 400, null);
  assert.deepEqual(shares.map((s) => s.shareAmount), [null, null]);
  assert.deepEqual(shares.map((s) => s.pct), [75, 25]);
});

test("con costo la somma delle quote torna esatta", () => {
  const players = [
    { id: "a", name: "A", seconds: 1 },
    { id: "b", name: "B", seconds: 1 },
    { id: "c", name: "C", seconds: 1 },
  ];
  const shares = buildPlayerShares(players, 3, { amount: 10 });
  const sum = shares.reduce((s, p) => s + (p.shareAmount ?? 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 10);
});
