/**
 * QueryGuard — Shared Utilities
 */

/** Generate a UUID v4 — uses crypto.randomUUID when available, falls back to Math.random */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Safe environment detection */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isServer(): boolean {
  return !isBrowser();
}

export function isEdgeRuntime(): boolean {
  return typeof process !== "undefined" &&
    // @ts-expect-error — edge runtime sets this
    process.env.NEXT_RUNTIME === "edge";
}

/** Get current timestamp as ISO 8601 string */
export function now(): string {
  return new Date().toISOString();
}

/** Clamp a number to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Safe window.location.href — returns "" on SSR */
export function safePageUrl(): string {
  if (!isBrowser()) return "";
  try {
    const url = new URL(window.location.href);
    // Strip sensitive query params that might contain tokens
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/** Derive deploy version from common environment variables */
export function detectDeployVersion(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return (
    process.env.NEXT_PUBLIC_DEPLOY_SHA ||
    process.env.NETLIFY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    undefined
  );
}

/** Generate a stable session ID stored in sessionStorage */
export function getOrCreateSessionId(): string {
  if (!isBrowser()) return "server";
  try {
    const key = "_qg_sid";
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = generateId();
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return generateId();
  }
}

/**
 * Exponential backoff delay — base * 2^attempt, capped at max
 */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  return Math.min(baseMs * Math.pow(2, attempt), maxMs);
}
