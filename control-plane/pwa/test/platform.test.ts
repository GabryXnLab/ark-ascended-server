import { test } from "node:test";
import assert from "node:assert/strict";
import { platformCopy, resolvePlatform, gameEndpoint } from "../src/platform.ts";

test("provider assente o oci usa i testi OCI", () => {
  assert.equal(platformCopy(undefined).compute, "VM");
  assert.equal(platformCopy("oci"), platformCopy(undefined));
  assert.match(platformCopy("oci").shutdownBackup, /Object Storage/);
});

test("docker usa container e cartella di backup", () => {
  const c = platformCopy("docker");
  assert.equal(c.compute, "container");
  assert.match(c.shutdownBackup, /cartella di backup/);
  assert.doesNotMatch(Object.values(c).join(" "), /OCI|Object Storage|VM/);
});

test("senza platform il fallback è OCI con costi e porta 7777", () => {
  const p = resolvePlatform({});
  assert.equal(p.provider, "oci");
  assert.equal(p.gamePort, 7777);
  assert.equal(p.features.costs, true);
  assert.equal(resolvePlatform(null).provider, "oci");
});

test("endpoint = publicIp + gamePort, null se spento", () => {
  const f = { costs: false, capacityRetry: false, storageLabel: "local" as const };
  assert.equal(gameEndpoint({ instance: { publicIp: "1.2.3.4" }, platform: { provider: "docker", gamePort: 7780, features: f } }), "1.2.3.4:7780");
  assert.equal(gameEndpoint({ instance: { publicIp: "1.2.3.4" } }), "1.2.3.4:7777");
  assert.equal(gameEndpoint({ instance: { publicIp: null } }), null);
});
