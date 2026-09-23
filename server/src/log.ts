/** Minimal structured-ish logger. Kept tiny on purpose; swap for pino later if needed. */
type Level = "info" | "warn" | "error" | "debug";

/** Structured context bag. `object` (not Record) so named interfaces pass without an index signature. */
type LogExtra = object;

function line(level: Level, msg: string, extra?: LogExtra): void {
  const ts = new Date().toISOString();
  const tail = extra && Object.keys(extra).length ? " " + JSON.stringify(extra) : "";
  const out = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`;
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  info: (msg: string, extra?: LogExtra) => line("info", msg, extra),
  warn: (msg: string, extra?: LogExtra) => line("warn", msg, extra),
  error: (msg: string, extra?: LogExtra) => line("error", msg, extra),
  debug: (msg: string, extra?: LogExtra) => line("debug", msg, extra),
};
