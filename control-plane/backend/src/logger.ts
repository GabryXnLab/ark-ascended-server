type Level = "info" | "warn" | "error" | "debug";
function emit(level: Level, msg: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  extra !== undefined ? out(line, extra) : out(line);
}
export const log = {
  debug: (m: string, e?: unknown) => process.env.DEBUG && emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
