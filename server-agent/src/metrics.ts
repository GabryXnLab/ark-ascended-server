// Metriche host: CPU%, RAM usata/totale, disco, uptime. Solo API Node + statfs.

import os from "node:os";
import { statfs } from "node:fs/promises";
import { config } from "./config.js";

export interface Metrics {
  cpuPct: number;
  memUsedGb: number;
  memTotalGb: number;
  diskUsedGb: number | null;
  diskTotalGb: number | null;
  uptimeSec: number;
}

const GB = 1024 ** 3;

// Snapshot dei tick CPU per calcolare la percentuale su un intervallo.
function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

let prev = cpuTimes();

export async function getMetrics(): Promise<Metrics> {
  const now = cpuTimes();
  const idleDiff = now.idle - prev.idle;
  const totalDiff = now.total - prev.total;
  prev = now;
  const cpuPct = totalDiff > 0 ? Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100)) : 0;

  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();

  let diskUsedGb: number | null = null;
  let diskTotalGb: number | null = null;
  try {
    const s = await statfs(config.arkInstallDir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    diskTotalGb = round1(total / GB);
    diskUsedGb = round1((total - free) / GB);
  } catch {
    // directory non presente in dev: lasciamo null
  }

  return {
    cpuPct: round1(cpuPct),
    memUsedGb: round1(memUsed / GB),
    memTotalGb: round1(memTotal / GB),
    diskUsedGb,
    diskTotalGb,
    uptimeSec: Math.round(os.uptime()),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
