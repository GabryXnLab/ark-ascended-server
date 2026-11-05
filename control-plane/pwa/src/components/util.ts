export function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function useAsyncAction() {
  // semplice helper: ritorna un runner che gestisce busy/errore via callback
  return async (fn: () => Promise<unknown>, onDone?: () => void, onErr?: (m: string) => void) => {
    try {
      await fn();
      onDone?.();
    } catch (e) {
      onErr?.(e instanceof Error ? e.message : String(e));
    }
  };
}
