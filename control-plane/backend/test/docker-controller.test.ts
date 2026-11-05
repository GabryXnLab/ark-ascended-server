import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerInstanceController } from "../src/oci/docker.js";
import { DockerApiError, DockerEngine, parseDockerHost } from "../src/oci/docker-engine.js";

interface Fake {
  engine: DockerEngine;
  calls: string[];
  set: (patch: Partial<Behaviour>) => void;
  close: () => Promise<void>;
}
interface Behaviour {
  status: string | null; // null = container inesistente
  startCode: number;
  stopDelayMs: number;
  stopCode: number;
  inspectDelayMs: number;
}

async function fakeDocker(timeoutMs = 2000): Promise<Fake> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arksa-docker-"));
  const socketPath = path.join(dir, "docker.sock");
  const b: Behaviour = { status: "exited", startCode: 204, stopDelayMs: 0, stopCode: 204, inspectDelayMs: 0 };
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const reply = (code: number, body?: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (b.status === null) return reply(404, { message: "No such container" });
    if (req.method === "GET") {
      return setTimeout(() => reply(200, { Id: "abc", Config: { Env: ["RCON_PASSWORD=x"] }, State: { Status: b.status } }), b.inspectDelayMs);
    }
    if (req.url?.endsWith("/start")) return reply(b.startCode);
    if (req.url?.endsWith("/stop")) return setTimeout(() => reply(b.stopCode), b.stopDelayMs);
    reply(500);
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  return {
    engine: new DockerEngine({ endpoint: { socketPath }, apiVersion: "v1.41", timeoutMs }),
    calls,
    set: (patch) => Object.assign(b, patch),
    close: async () => {
      await new Promise((r) => server.close(r));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("mappa gli stati del container sugli stati istanza", async () => {
  const f = await fakeDocker();
  try {
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "play.example.com");
    const expected: Record<string, [string, string | null]> = {
      running: ["RUNNING", "play.example.com"],
      restarting: ["STARTING", null],
      created: ["STOPPED", null],
      exited: ["STOPPED", null],
      removing: ["STOPPING", null],
      paused: ["UNKNOWN", null],
      dead: ["UNKNOWN", null],
    };
    for (const [status, [state, ip]] of Object.entries(expected)) {
      f.set({ status });
      const info = await ctrl.getInfo();
      assert.equal(info.state, state, status);
      assert.equal(info.publicIp, ip, status);
      assert.equal(info.ocid, "docker:game");
    }
  } finally { await f.close(); }
});

test("publicIp null se PUBLIC_HOST non è impostato", async () => {
  const f = await fakeDocker();
  try {
    f.set({ status: "running" });
    assert.equal((await new DockerInstanceController("game", f.engine, 2000, "").getInfo()).publicIp, null);
  } finally { await f.close(); }
});

test("start accetta 204 e 304", async () => {
  const f = await fakeDocker();
  try {
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "");
    await ctrl.start();
    f.set({ startCode: 304 });
    await ctrl.start();
    assert.equal(f.calls.filter((c) => c.endsWith("/start")).length, 2);
  } finally { await f.close(); }
});

test("container mancante: getInfo UNKNOWN, start 404 con messaggio per l'utente", async () => {
  const f = await fakeDocker();
  try {
    f.set({ status: null });
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "");
    assert.equal((await ctrl.getInfo()).state, "UNKNOWN");
    await assert.rejects(ctrl.start(), (e: unknown) =>
      e instanceof DockerApiError && e.statusCode === 404 && /docker compose --profile game create/.test(e.userMessage ?? ""));
    await ctrl.stop(); // nulla da fermare: non solleva
  } finally { await f.close(); }
});

test("durante uno stop lento lo stato è STOPPING, poi torna quello reale", async () => {
  const f = await fakeDocker();
  try {
    f.set({ status: "running", stopDelayMs: 150 });
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "h");
    const stopping = ctrl.stop();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await ctrl.getInfo()).state, "STOPPING");
    f.set({ status: "exited" });
    await stopping;
    assert.equal((await ctrl.getInfo()).state, "STOPPED");
  } finally { await f.close(); }
});

test("errore HTTP inatteso e flag STOPPING ripulito", async () => {
  const f = await fakeDocker();
  try {
    f.set({ status: "running", stopCode: 500 });
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "");
    await assert.rejects(ctrl.stop(), (e: unknown) => e instanceof DockerApiError && e.statusCode === 500);
    assert.equal((await ctrl.getInfo()).state, "RUNNING");
  } finally { await f.close(); }
});

test("timeout del client: getInfo solleva", async () => {
  const f = await fakeDocker(80);
  try {
    f.set({ status: "running", inspectDelayMs: 400 });
    const ctrl = new DockerInstanceController("game", f.engine, 2000, "");
    await assert.rejects(ctrl.getInfo(), (e: unknown) => e instanceof DockerApiError && e.statusCode === 0 && /timeout/.test(e.message));
  } finally { await f.close(); }
});

test("Docker non raggiungibile: getInfo solleva", async () => {
  const engine = new DockerEngine({ endpoint: { socketPath: path.join(os.tmpdir(), "arksa-nessun-socket.sock") }, apiVersion: "v1.41" });
  await assert.rejects(new DockerInstanceController("game", engine, 2000, "").getInfo(), DockerApiError);
});

test("parse di DOCKER_HOST", () => {
  assert.deepEqual(parseDockerHost("unix:///var/run/docker.sock"), { socketPath: "/var/run/docker.sock" });
  assert.deepEqual(parseDockerHost("/tmp/d.sock"), { socketPath: "/tmp/d.sock" });
  assert.deepEqual(parseDockerHost("tcp://docker-proxy:2375"), { host: "docker-proxy", port: 2375 });
  assert.deepEqual(parseDockerHost("tcp://10.0.0.5"), { host: "10.0.0.5", port: 2375 });
  assert.throws(() => parseDockerHost("ssh://host"), /non supportato/);
  assert.throws(() => parseDockerHost("non un url"), /non valido/);
});
