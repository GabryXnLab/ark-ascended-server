// Archivio dei salvataggi di UN solo profilo. ASA riceve l'UUID del profilo come
// AltSaveDirectoryName (launch.sh) e scrive mondo, giocatori e tribù sotto
// Saved/<profileId>/ (in pratica Saved/<profileId>/<Mappa>/). Il resto di Saved/
// non deve mai finire nel bucket né essere sovrascritto da un ripristino: Config/
// contiene ServerAdminPassword e gli INI gestiti, le cartelle sorelle sono i mondi
// degli altri profili, Logs/ e i crash dump sono solo rumore.
//
// Si archivia per allowlist (estensioni di salvataggio), non per esclusione: un
// file nuovo o inatteso resta fuori ed è elencato nel log, invece di finire nel
// bucket per caso. Le copie a rotazione con timestamp di ASA e i `.corrupt-*`
// conservati a mano restano sul disco: il bucket ha già il proprio versioning.
//
// I tar vengono eseguiti sempre davvero (niente shell.run, che in mock simula):
// il mock si ferma a monte, in backup.ts/restore.ts.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);
const TAR_TIMEOUT_MS = 10 * 60_000;

const SAVE_EXTENSIONS = new Set([".ark", ".arkprofile", ".arktribe", ".arktributetribe"]);
// Copie a rotazione di ASA: <Mappa>_DD.MM.YYYY_HH.MM.SS.ark
const ROTATED_ARK = /_\d{2}\.\d{2}\.\d{4}_\d{2}\.\d{2}\.\d{2}\.ark$/i;
// ASCII stampabile senza backslash: `tar -t` stampa questi nomi senza escape e
// una riga per membro, quindi l'elenco resta confrontabile riga per riga.
const SAFE_SEGMENT = /^[\x20-\x5b\x5d-\x7e]+$/;
// L'UUID diventa il nome di una cartella sotto Saved/: nessun separatore, niente
// nomi nascosti (le cartelle temporanee del ripristino iniziano con un punto).
const SAFE_PROFILE_ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

export function assertSafeProfileId(profileId: string): void {
  if (!SAFE_PROFILE_ID.test(profileId)) throw new Error(`profileId non valido: ${JSON.stringify(profileId)}`);
}

export function profileSaveDir(savedRoot: string, profileId: string): string {
  assertSafeProfileId(profileId);
  return path.join(savedRoot, profileId);
}

/** true se il path relativo (separatore `/`) è un file di salvataggio da archiviare. */
export function isSaveFile(relPath: string): boolean {
  const segments = relPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || !SAFE_SEGMENT.test(s))) return false;
  const name = segments[segments.length - 1]!;
  const ext = path.extname(name).toLowerCase();
  if (!SAVE_EXTENSIONS.has(ext)) return false;
  if (ext === ".ark" && (ROTATED_ARK.test(name) || name.toLowerCase().includes(".corrupt"))) return false;
  return true;
}

function isWorldFile(relPath: string): boolean {
  return path.extname(relPath).toLowerCase() === ".ark";
}

export interface SaveFileList {
  included: string[];
  excluded: string[];
}

/** Elenca i file della cartella profilo (ricorsivo, senza seguire link), ordinati. */
export async function listSaveFiles(profileDir: string): Promise<SaveFileList> {
  const included: string[] = [];
  const excluded: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(profileDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && isSaveFile(child)) included.push(child);
      else excluded.push(child);
    }
  }
  await walk("");
  included.sort();
  excluded.sort();
  return { included, excluded };
}

async function tar(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tar", args, { timeout: TAR_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`tar ${args[0]} ${args[1] ?? ""} fallito: ${err.stderr || err.message}`);
  }
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l !== "");
}

/**
 * Crea `tarball` (zstd) con i soli file di salvataggio di `profileDir`, a path
 * relativi alla cartella profilo (così si può ripristinare anche su un profilo con
 * id diverso), e lo rilegge per intero confrontando l'elenco dei membri. Lancia se
 * non c'è un mondo da salvare: un archivio senza .ark sovrascriverebbe la copia buona.
 */
export async function createSaveArchive(profileDir: string, tarball: string): Promise<SaveFileList> {
  const files = await listSaveFiles(profileDir);
  if (!files.included.some(isWorldFile)) {
    throw new Error(`nessun mondo (.ark) in ${profileDir}: niente da archiviare`);
  }
  const listFile = `${tarball}.files`;
  try {
    await fs.writeFile(listFile, files.included.join("\0") + "\0", "utf8");
    await tar(["--zstd", "-cf", tarball, "-C", profileDir, "--null", "--verbatim-files-from", "-T", listFile]);
  } finally {
    await fs.rm(listFile, { force: true });
  }
  const members = lines(await tar(["--zstd", "-tf", tarball]));
  if (members.join("\n") !== files.included.join("\n")) {
    throw new Error("archivio incoerente: i membri letti non corrispondono ai file inclusi");
  }
  return files;
}

/** Valida i membri senza estrarre: solo file regolari di salvataggio a path relativo. */
export async function validateSaveArchive(tarball: string): Promise<string[]> {
  const names = lines(await tar(["--zstd", "-tf", tarball]));
  const verbose = lines(await tar(["--zstd", "-tvf", tarball]));
  if (names.length === 0) throw new Error("archivio vuoto");
  if (verbose.length !== names.length) throw new Error("archivio con nomi non rappresentabili");
  names.forEach((name, i) => {
    // `-` = file regolare: niente link, device o directory con permessi arbitrari.
    if (verbose[i]![0] !== "-") throw new Error(`membro non regolare nell'archivio: ${name}`);
    if (!isSaveFile(name)) throw new Error(`membro non ammesso nell'archivio: ${name}`);
  });
  if (!names.some(isWorldFile)) throw new Error("archivio senza mondo (.ark)");
  return names;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sostituisce Saved/<profileId>/ con il contenuto di `tarball`. Da chiamare a ASA
 * fermo. L'archivio viene validato ed estratto in una cartella temporanea accanto
 * al target (stesso filesystem, così i rename sono atomici); solo a estrazione
 * completa la cartella corrente viene spostata da parte, sostituita e poi rimossa.
 * Non tocca nient'altro sotto Saved/.
 */
export async function restoreSaveArchive(tarball: string, savedRoot: string, profileId: string): Promise<string[]> {
  const target = profileSaveDir(savedRoot, profileId);
  const staging = path.join(savedRoot, `.restore-${profileId}`);
  const previous = path.join(savedRoot, `.previous-${profileId}`);
  await fs.mkdir(savedRoot, { recursive: true });

  // Un ripristino interrotto fra i due rename lascia il profilo solo in `previous`.
  if (await exists(previous)) {
    if (await exists(target)) await fs.rm(previous, { recursive: true, force: true });
    else await fs.rename(previous, target);
  }
  await fs.rm(staging, { recursive: true, force: true });

  const members = await validateSaveArchive(tarball);
  try {
    await fs.mkdir(staging);
    await tar(["--zstd", "-xf", tarball, "-C", staging, "--no-same-owner", "--no-same-permissions"]);
    const extracted = await listSaveFiles(staging);
    if (extracted.excluded.length > 0 || extracted.included.join("\n") !== [...members].sort().join("\n")) {
      throw new Error("estrazione incoerente con l'elenco validato dell'archivio");
    }

    const hadTarget = await exists(target);
    if (hadTarget) await fs.rename(target, previous);
    try {
      await fs.rename(staging, target);
    } catch (e) {
      if (hadTarget) await fs.rename(previous, target);
      throw e;
    }
    if (hadTarget) await fs.rm(previous, { recursive: true, force: true });
    return extracted.included;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
