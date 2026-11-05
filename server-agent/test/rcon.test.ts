import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListPlayers } from "../src/rcon.js";

test("nessun giocatore connesso → array vuoto", () => {
  assert.deepEqual(parseListPlayers("No Players Connected"), []);
  assert.deepEqual(parseListPlayers(""), []);
});

test("parsa elenco giocatori con id EOS alfanumerico", () => {
  const out = "0. Tek, 0002a1b2c3XYZ\n1. Rex, 00ffee1122";
  assert.deepEqual(parseListPlayers(out), [
    { name: "Tek", id: "0002a1b2c3XYZ" },
    { name: "Rex", id: "00ffee1122" },
  ]);
});

test("riga senza id non rompe il parsing", () => {
  const out = "0. SoloName";
  const players = parseListPlayers(out);
  assert.equal(players.length, 1);
  assert.equal(players[0]?.name, "SoloName");
});
