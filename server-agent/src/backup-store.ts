// Archivio dei backup dei salvataggi: Object Storage OCI oppure cartella locale
// (modalità Docker). Chiavi e formato sono identici (`saves/<profileId>.tar.zst`)
// perché savegames.json e PWA non devono distinguere i due archivi.

import path from "node:path";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { config } from "./config.js";
import { log } from "./logger.js";

export interface BackupStore {
  /** Etichetta leggibile della destinazione, solo per i log. */
  readonly label: string;
  /** Carica `file` come `objectKey`, sovrascrivendo la copia corrente. Ritorna i byte scritti. */
  put(objectKey: string, file: string): Promise<number>;
  /** Scarica `objectKey` in `dest`. Lancia se la chiave non esiste. */
  fetch(objectKey: string, dest: string): Promise<void>;
}

const OBJECT_KEY_RE = /^saves\/[A-Za-z0-9_-]+\.tar\.zst$/;

/**
 * Valida la chiave di un backup. Su filesystem il traversal è reale, e la stessa
 * regola vale in modalità OCI per non avere due contratti diversi sulle rotte.
 */
export function assertValidObjectKey(objectKey: unknown): asserts objectKey is string {
  if (typeof objectKey !== "string" || !OBJECT_KEY_RE.test(objectKey)) {
    throw new InvalidObjectKeyError();
  }
}

export class InvalidObjectKeyError extends Error {
  constructor() {
    super("objectKey non valida (atteso saves/<profileId>.tar.zst)");
    this.name = "InvalidObjectKeyError";
  }
}

export class OciBackupStore implements BackupStore {
  get label(): string {
    return config.backupBucket;
  }

  // Import dinamici: in modalità docker oci-sdk non deve mai essere caricato.
  private async client() {
    const { buildObjectStorageClient, getNamespace } = await import("./oci-client.js");
    const client = await buildObjectStorageClient();
    return { client, namespace: await getNamespace(client) };
  }

  async put(objectKey: string, file: string): Promise<number> {
    assertValidObjectKey(objectKey);
    const { client, namespace } = await this.client();
    const body = await fs.readFile(file);
    await client.putObject({
      namespaceName: namespace,
      bucketName: config.backupBucket,
      objectName: objectKey,
      putObjectBody: body,
      contentLength: body.length,
    });
    return body.length;
  }

  async fetch(objectKey: string, dest: string): Promise<void> {
    assertValidObjectKey(objectKey);
    const { client, namespace } = await this.client();
    const res = await client.getObject({
      namespaceName: namespace,
      bucketName: config.backupBucket,
      objectName: objectKey,
    });
    await pipeline(res.value as Readable, createWriteStream(dest));
  }
}

export interface LocalBackupOptions {
  keepVersions: number;
  retentionDays: number;
  now?: () => number;
}

// Agent (utente steam) e pannello (altro uid) condividono la cartella solo via
// gruppo: i file devono essere 0660 a prescindere dalla umask del processo.
const FILE_MODE = 0o660;
const DIR_MODE = 0o770;

export class LocalBackupStore implements BackupStore {
  private readonly root: string;
  private readonly now: () => number;

  constructor(
    dir: string,
    private readonly opts: LocalBackupOptions,
  ) {
    this.root = path.resolve(dir);
    this.now = opts.now ?? Date.now;
  }

  get label(): string {
    return this.root;
  }

  private resolveKey(objectKey: string): string {
    assertValidObjectKey(objectKey);
    const full = path.resolve(this.root, objectKey);
    if (!full.startsWith(this.root + path.sep)) throw new InvalidObjectKeyError();
    return full;
  }

  private versionsDir(objectKey: string): string {
    const id = path.basename(objectKey, ".tar.zst");
    return path.join(this.root, "saves", ".versions", id);
  }

  async put(objectKey: string, file: string): Promise<number> {
    const target = this.resolveKey(objectKey);
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });

    // tmp nella stessa cartella: il rename finale è atomico e il backup corrente
    // non è mai troncato, nemmeno se il processo muore a metà copia.
    const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${this.now()}`);
    let size = 0;
    try {
      await pipeline(createReadStream(file), createWriteStream(tmp, { flags: "w", mode: FILE_MODE }));
      const fh = await fs.open(tmp, "r+");
      try {
        await fh.sync();
        await fh.chmod(FILE_MODE);
        size = (await fh.stat()).size;
      } finally {
        await fh.close();
      }
      await this.keepPrevious(objectKey, target);
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    await this.syncDir(dir);
    await this.prune(objectKey).catch((e) => log.warn("backup: pulizia versioni fallita", e));
    return size;
  }

  async fetch(objectKey: string, dest: string): Promise<void> {
    const src = this.resolveKey(objectKey);
    try {
      await pipeline(createReadStream(src), createWriteStream(dest));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`backup non trovato: ${objectKey}`);
      }
      throw e;
    }
  }

  // Hard link e non rename: finché il rename finale non riesce, la copia corrente resta al suo posto.
  private async keepPrevious(objectKey: string, target: string): Promise<void> {
    if (this.opts.keepVersions <= 0) return;
    let st;
    try {
      st = await fs.stat(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    const vdir = this.versionsDir(objectKey);
    await fs.mkdir(vdir, { recursive: true, mode: DIR_MODE });
    const name = `${st.mtime.toISOString().replace(/[:.]/g, "-")}.tar.zst`;
    const dest = path.join(vdir, name);
    await fs.rm(dest, { force: true });
    try {
      await fs.link(target, dest);
    } catch {
      await fs.copyFile(target, dest);
      await fs.chmod(dest, FILE_MODE);
    }
  }

  private async prune(objectKey: string): Promise<void> {
    const vdir = this.versionsDir(objectKey);
    let names: string[];
    try {
      names = (await fs.readdir(vdir)).filter((n) => n.endsWith(".tar.zst"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    // Il nome è l'mtime ISO: l'ordine lessicografico è quello cronologico.
    names.sort().reverse();
    const cutoff =
      this.opts.retentionDays > 0 ? this.now() - this.opts.retentionDays * 86_400_000 : null;
    for (let i = 0; i < names.length; i++) {
      const file = path.join(vdir, names[i]!);
      let drop = i >= this.opts.keepVersions;
      if (!drop && cutoff !== null) drop = (await fs.stat(file)).mtimeMs < cutoff;
      if (drop) await fs.rm(file, { force: true });
    }
  }

  private async syncDir(dir: string): Promise<void> {
    try {
      const fh = await fs.open(dir, "r");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch {
      // fsync della cartella non supportato su alcuni filesystem: il rename resta atomico.
    }
  }
}

export function getBackupStore(): BackupStore {
  if (config.platform === "docker") {
    return new LocalBackupStore(config.backupDir, {
      keepVersions: config.backupKeepVersions,
      retentionDays: config.backupRetentionDays,
    });
  }
  return new OciBackupStore();
}
