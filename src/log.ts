// Hataları hem konsola hem ekrana yazar.
type Level = "info" | "warn" | "error";
interface Entry { t: string; level: Level; msg: string }

const entries: Entry[] = [];
const listeners: Array<(e: Entry) => void> = [];

export function log(level: Level, msg: string, err?: unknown): void {
  const detail = err === undefined ? "" : " :: " + describeError(err);
  const full = msg + detail;
  entries.push({ t: new Date().toLocaleTimeString("tr-TR"), level, msg: full });
  if (entries.length > 200) entries.shift();
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)("[GameSubs]", full);
  const entry = entries[entries.length - 1];
  listeners.forEach((l) => l(entry));
}

export const info = (m: string, e?: unknown) => log("info", m, e);
export const warn = (m: string, e?: unknown) => log("warn", m, e);
export const error = (m: string, e?: unknown) => log("error", m, e);

export function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { name?: string; message?: string };
    if (o.name || o.message) return `${o.name ?? "Error"}: ${o.message ?? ""}`;
  }
  return String(e);
}

export function recent(n: number): Entry[] { return entries.slice(-n); }
export function onLog(fn: (e: Entry) => void): void { listeners.push(fn); }

export function installGlobalHandlers(): void {
  window.addEventListener("error", (e) => error("window.onerror", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => error("unhandledrejection", e.reason));
}
