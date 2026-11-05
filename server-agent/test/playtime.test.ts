import "./env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { config } from "../src/config.js";
import { __mock } from "../src/ark.js";
import { getClosedSessions, getLiveSessions, __test } from "../src/playtime.js";

test.after(async () => {
  await fs.rm(config.playtimeLogFile, { force: true });
});

test("ciclo connessione/disconnessione produce una sessione chiusa", async () => {
  __mock.setOnline(true);
  __mock.setPlayers([{ id: "abc123", name: "Tek" }]);
  await __test.tick();

  const liveList = getLiveSessions();
  assert.equal(liveList.length, 1);
  assert.equal(liveList[0]?.name, "Tek");

  await new Promise((r) => setTimeout(r, 1100));
  __mock.setPlayers([]);
  await __test.tick();
  assert.equal(getLiveSessions().length, 0);

  const closed = await getClosedSessions();
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.playerId, "abc123");
  assert.ok((closed[0]?.durationSec ?? 0) >= 1);
});

test("getClosedSessions filtra per since", async () => {
  const all = await getClosedSessions();
  assert.ok(all.length >= 1);
  const future = new Date(Date.now() + 3600_000).toISOString();
  const filtered = await getClosedSessions(future);
  assert.equal(filtered.length, 0);
});
