// Logger minimale con timestamp e livello. Nessuna dipendenza.

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] ${msg}`;
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (extra !== undefined) stream(line, extra);
  else stream(line);
}

export const log = {
  debug: (m: string, e?: unknown) => {
    if (process.env.DEBUG) emit("debug", m, e);
  },
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
