/**
 * In-app debug log. Captures console errors/warnings, uncaught errors, unhandled promise
 * rejections, and app events (connection lifecycle, protocol mismatches) into a ring buffer the
 * player can view and copy from the Debug overlay — so a bug report is one tap away.
 */
import { PROTOCOL_VERSION } from "./protocol";

export interface LogEntry {
  t: number; // epoch ms
  level: "error" | "warn" | "info";
  text: string;
}

const MAX = 400;
const buffer: LogEntry[] = [];
const listeners = new Set<() => void>();
let errorCount = 0;
let installed = false;

function emit() {
  for (const l of listeners) l();
}

function push(level: LogEntry["level"], text: string) {
  buffer.push({ t: Date.now(), level, text: text.slice(0, 1000) });
  if (buffer.length > MAX) buffer.shift();
  if (level === "error") errorCount++;
  emit();
}

/** App-level event (connection open/close, protocol mismatch, etc.). */
export function logDebug(level: LogEntry["level"], text: string) {
  push(level, text);
}

export function subscribeDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function debugEntries(): LogEntry[] {
  return buffer;
}

export function debugErrorCount(): number {
  return errorCount;
}

export function clearDebug(): void {
  buffer.length = 0;
  errorCount = 0;
  emit();
}

/** A copy-pasteable report: an environment header + the captured log. */
export function debugReport(): string {
  const env = [
    `House of Ghouls — debug report`,
    `time: ${new Date().toISOString()}`,
    `protocol: v${PROTOCOL_VERSION}`,
    `wsUrl: ${(process.env.EXPO_PUBLIC_WS_URL as string | undefined) ?? "(unset)"}`,
    `mode: ${(process.env.NODE_ENV as string | undefined) ?? "?"}`,
    typeof navigator !== "undefined" ? `ua: ${navigator.userAgent}` : "",
    `entries: ${buffer.length} (errors: ${errorCount})`,
    "----",
  ].filter(Boolean).join("\n");
  const lines = buffer.map((e) => `[${new Date(e.t).toLocaleTimeString()}] ${e.level.toUpperCase()} ${e.text}`);
  return env + "\n" + lines.join("\n");
}

/** Install global capture hooks once (safe to call multiple times). */
export function installDebugCapture(): void {
  if (installed) return;
  installed = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    push("error", args.map(fmt).join(" "));
    origError(...(args as []));
  };
  console.warn = (...args: unknown[]) => {
    push("warn", args.map(fmt).join(" "));
    origWarn(...(args as []));
  };

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("error", (e: ErrorEvent) => {
      push("error", `uncaught: ${e.message} @ ${e.filename ?? "?"}:${e.lineno ?? 0}`);
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      push("error", `unhandled rejection: ${fmt(e.reason)}`);
    });
  }
  push("info", "debug capture started");
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
