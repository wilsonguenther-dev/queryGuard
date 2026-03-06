/**
 * QueryGuard — Redaction Pipeline
 *
 * Ensures no secrets, tokens, passwords, or PII leak into event payloads.
 * Applied before any event is shipped to the ingestion endpoint.
 */

import type { RedactionConfig } from "../types/index.js";

// ─── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_REDACTION_CONFIG: Required<RedactionConfig> = {
  redactHeaders: [
    "authorization",
    "cookie",
    "set-cookie",
    "x-auth-token",
    "x-api-key",
    "x-access-token",
    "x-refresh-token",
    "apikey",
    "api-key",
    "x-supabase-auth",
  ],
  redactBodyFields: [
    "password",
    "passwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "private_key",
    "credit_card",
    "card_number",
    "cvv",
    "ssn",
  ],
  maxMetadataValueLength: 500,
  maxBodySize: 0, // no body logging by default — opt-in
};

// ─── Header Redaction ────────────────────────────────────────────────────────

/**
 * Redact sensitive headers from a Headers object or plain record.
 * Returns a new plain object with sensitive values replaced.
 */
export function redactHeaders(
  headers: Record<string, string> | Headers | undefined,
  config: Required<RedactionConfig> = DEFAULT_REDACTION_CONFIG
): Record<string, string> {
  if (!headers) return {};

  const result: Record<string, string> = {};
  const blocklist = new Set(config.redactHeaders.map((h) => h.toLowerCase()));

  const entries: [string, string][] =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Object.entries(headers);

  for (const [key, value] of entries) {
    result[key] = blocklist.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }

  return result;
}

// ─── Body Redaction ───────────────────────────────────────────────────────────

/**
 * Redact sensitive fields from a request/response body object.
 * Only processes plain objects — ignores non-objects safely.
 */
export function redactBody(
  body: unknown,
  config: Required<RedactionConfig> = DEFAULT_REDACTION_CONFIG
): unknown {
  if (config.maxBodySize === 0) return undefined; // body logging disabled
  if (body === null || body === undefined) return undefined;
  if (typeof body !== "object" || Array.isArray(body)) return undefined;

  const blocklist = new Set(config.redactBodyFields.map((f) => f.toLowerCase()));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    result[key] = blocklist.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }

  return result;
}

// ─── Metadata Sanitization ───────────────────────────────────────────────────

/**
 * Sanitize a metadata object for safe ingestion:
 * - Truncate long string values
 * - Remove circular references
 * - Remove undefined values
 * - Cap depth at 2 levels
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  config: Required<RedactionConfig> = DEFAULT_REDACTION_CONFIG
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  try {
    return safeSerialize(metadata, config.maxMetadataValueLength, 0);
  } catch {
    return { _error: "metadata serialization failed" };
  }
}

function safeSerialize(
  obj: unknown,
  maxLen: number,
  depth: number
): Record<string, unknown> {
  if (depth > 2) return { _truncated: true };
  if (typeof obj !== "object" || obj === null) return {};

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      result[key] = value.length > maxLen ? value.slice(0, maxLen) + "…" : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (typeof value === "object" && !Array.isArray(value)) {
      result[key] = safeSerialize(value, maxLen, depth + 1);
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 10).map((item) =>
        typeof item === "string"
          ? item.slice(0, maxLen)
          : typeof item === "object"
          ? safeSerialize(item, maxLen, depth + 1)
          : item
      );
    } else {
      result[key] = String(value).slice(0, maxLen);
    }
  }

  return result;
}

// ─── URL Redaction ────────────────────────────────────────────────────────────

/**
 * Strip query parameters from a URL (they often contain tokens).
 * Keeps the path intact.
 */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    // Remove all query params — they frequently contain access tokens
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    // Not a valid URL — strip anything after ?
    return url.split("?")[0].split("#")[0];
  }
}

// ─── Safe JSON Serialization ─────────────────────────────────────────────────

/**
 * JSON.stringify that never throws.
 * Handles circular references and non-serializable values.
 */
export function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      if (typeof val === "function") return "[Function]";
      if (typeof val === "symbol") return "[Symbol]";
      if (val instanceof Error) return { message: val.message, stack: val.stack };
      return val;
    });
  } catch {
    return JSON.stringify({ _error: "serialization failed" });
  }
}
