import { redactSecrets } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

function write(level: LogLevel, message: string, extra?: Readonly<Record<string, unknown>>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    return;
  }
  const payload =
    extra === undefined
      ? { ts: new Date().toISOString(), level, message }
      : { ts: new Date().toISOString(), level, message, ...extra };
  process.stderr.write(`${redactSecrets(JSON.stringify(payload))}\n`);
}

export const logger = {
  debug: (message: string, extra?: Readonly<Record<string, unknown>>): void =>
    write("debug", message, extra),
  info: (message: string, extra?: Readonly<Record<string, unknown>>): void =>
    write("info", message, extra),
  warn: (message: string, extra?: Readonly<Record<string, unknown>>): void =>
    write("warn", message, extra),
  error: (message: string, extra?: Readonly<Record<string, unknown>>): void =>
    write("error", message, extra),
};
