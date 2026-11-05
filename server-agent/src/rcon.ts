// Client RCON (protocollo Source/Valve) su TCP — nessuna dipendenza esterna.
// ARK: Survival Ascended espone RCON con questo protocollo.
//
// Formato pacchetto (little-endian):
//   int32 size  (lunghezza del resto del pacchetto)
//   int32 id
//   int32 type
//   body  (stringa ASCII null-terminated)
//   byte  0     (terminatore extra)
//
// Tipi: 3 = AUTH, 2 = EXEC/AUTH_RESPONSE, 0 = RESPONSE_VALUE.

import net from "node:net";

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_RESPONSE = 0;

function encode(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "ascii");
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, 12 + bodyBuf.length);
  buf.writeInt8(0, 12 + bodyBuf.length + 1);
  return buf;
}

interface Packet {
  id: number;
  type: number;
  body: string;
}

// Buffer è generico in TS recenti; usiamo l'alias permissivo per l'accumulatore.
type Buf = Buffer<ArrayBufferLike>;

// Estrae i pacchetti completi da un buffer accumulato.
function drain(acc: Buf): { packets: Packet[]; rest: Buf } {
  const packets: Packet[] = [];
  let offset = 0;
  while (acc.length - offset >= 4) {
    const size = acc.readInt32LE(offset);
    if (acc.length - offset - 4 < size) break; // pacchetto incompleto
    const id = acc.readInt32LE(offset + 4);
    const type = acc.readInt32LE(offset + 8);
    const body = acc.toString("ascii", offset + 12, offset + 4 + size - 2);
    packets.push({ id, type, body });
    offset += 4 + size;
  }
  return { packets, rest: acc.subarray(offset) };
}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
}

/**
 * Apre una connessione, autentica, esegue un singolo comando e chiude.
 * Restituisce il corpo della risposta. Lancia in caso di auth fallita o timeout.
 */
export function rconCommand(opts: RconOptions, command: string): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let acc: Buf = Buffer.alloc(0);
    let authed = false;
    const reqId = 1;
    const cmdId = 2;
    let settled = false;

    const timer = setTimeout(() => fail(new Error("RCON timeout")), timeoutMs);

    function done(value: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(value);
    }
    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    }

    socket.on("connect", () => {
      socket.write(encode(reqId, TYPE_AUTH, opts.password));
    });

    socket.on("data", (chunk) => {
      acc = Buffer.concat([acc, chunk]);
      const { packets, rest } = drain(acc);
      acc = rest;
      for (const p of packets) {
        if (!authed) {
          // L'AUTH_RESPONSE ha id == reqId se ok, -1 se fallita.
          if (p.type === TYPE_EXEC || p.type === TYPE_RESPONSE) {
            if (p.id === -1) {
              fail(new Error("RCON autenticazione fallita (password errata)"));
              return;
            }
            if (p.id === reqId) {
              authed = true;
              socket.write(encode(cmdId, TYPE_EXEC, command));
            }
          }
        } else if (p.type === TYPE_RESPONSE && p.id === cmdId) {
          done(p.body.trim());
        }
      }
    });

    socket.on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))));
    socket.on("close", () => {
      if (!settled) fail(new Error("connessione RCON chiusa prima della risposta"));
    });
  });
}

export interface Player {
  id: string;
  name: string;
}

/** Esegue ListPlayers e ritorna l'elenco. "No Players Connected" → []. */
export async function listPlayers(opts: RconOptions): Promise<Player[]> {
  const out = await rconCommand(opts, "ListPlayers");
  return parseListPlayers(out);
}

// Formato tipico ARK: "0. PlayerName, 0002a... " una riga per giocatore.
export function parseListPlayers(out: string): Player[] {
  const text = out.trim();
  if (!text || /no players? connected/i.test(text)) return [];
  const players: Player[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // togli l'eventuale indice iniziale "<idx>. "
    const line = raw.trim().replace(/^\d+\.\s*/, "");
    if (!line) continue;
    // "<name>, <steam/eos id>"
    const m = line.match(/^(.+?),\s*([A-Za-z0-9]+)\s*$/);
    if (m && m[1] && m[2]) {
      players.push({ name: m[1].trim(), id: m[2].trim() });
    } else {
      players.push({ name: line, id: "" });
    }
  }
  return players;
}
