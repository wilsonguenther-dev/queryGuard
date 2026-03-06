/**
 * QueryGuard — Fingerprint Generation
 *
 * Produces a deterministic, stable grouping key for an event so that
 * thousands of occurrences of the same failure collapse into one issue.
 *
 * Algorithm:
 *   {category}|{entity}|{http_status}|{normalized_route}|{core_message}
 *
 * Dynamic path segments are stripped so /users/abc-123 and /users/xyz-456
 * both normalize to /users/:id.
 */

import type { QueryGuardEvent } from "../types/index.js";
import { normalizeRoute } from "../normalize/index.js";

/**
 * Strip dynamic segments from a message so it groups correctly.
 * Removes UUIDs, numeric IDs, and email-like strings.
 */
function coreMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\b\d{6,}\b/g, ":id")
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g, ":email")
    .replace(/Bearer\s+\S+/gi, "Bearer :token")
    .trim()
    .slice(0, 200); // cap length
}

/**
 * Simple non-cryptographic hash for a string → compact hex prefix.
 * djb2 variant — fast, stable, no dependencies.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Create a fingerprint from a QueryGuardEvent.
 * Returns a string prefixed with "qg_" for easy identification.
 */
export function createFingerprint(event: {
  category: string;
  entity?: string;
  http_status?: number;
  route?: string;
  normalized_route?: string;
  message: string;
}): string {
  const parts = [
    event.category,
    event.entity ?? "unknown",
    String(event.http_status ?? 0),
    event.normalized_route ?? normalizeRoute(event.route ?? ""),
    coreMessage(event.message),
  ];
  const key = parts.join("|");
  return `qg_${djb2Hash(key)}`;
}

/**
 * Create a fingerprint directly from raw components.
 * Useful when building events before they are fully shaped.
 */
export function createFingerprintFromParts(
  category: string,
  entity: string | undefined,
  httpStatus: number | undefined,
  route: string | undefined,
  message: string
): string {
  return createFingerprint({
    category,
    entity,
    http_status: httpStatus,
    route,
    message,
  });
}

/**
 * Regenerate fingerprint from a fully formed event (convenience wrapper).
 */
export function fingerprintEvent(event: QueryGuardEvent): string {
  return createFingerprint(event);
}
