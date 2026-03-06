/**
 * QueryGuard — Core Event Capture
 *
 * captureException / captureMessage — the two primary SDK entry points
 * for manual error reporting. These are the same surface area as Sentry's
 * equivalents, intentionally.
 */

import type {
  QueryGuardEvent,
  Severity,
  ErrorCategory,
  UserContext,
} from "../types/index.js";
import { createFingerprint } from "../fingerprint/index.js";
import { normalizeRoute, normalizeStack } from "../normalize/index.js";
import { sanitizeMetadata } from "../redaction/index.js";
import { generateId, now, safePageUrl, getOrCreateSessionId } from "../utils/index.js";
import { getConfig, getQueue, isInitialized, SDK_INFO } from "./init.js";
import { getBreadcrumbs } from "./breadcrumbs.js";

// ─── Guard against logging our own errors ────────────────────────────────────

let _isCapturing = false;

function withCaptureGuard(fn: () => void): void {
  if (_isCapturing) return; // prevent recursive logging
  _isCapturing = true;
  try {
    fn();
  } finally {
    _isCapturing = false;
  }
}

// ─── Build a QueryGuardEvent ──────────────────────────────────────────────────

export interface CaptureOptions {
  severity?: Severity;
  category?: ErrorCategory;
  entity?: string;
  route?: string;
  httpMethod?: string;
  httpStatus?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  user?: UserContext;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  fingerprint?: string; // override auto-generated
}

function buildEvent(
  message: string,
  stack: string | undefined,
  opts: CaptureOptions
): QueryGuardEvent {
  const config = getConfig();

  const route = opts.route ?? safePageUrl();
  const normalizedRoute = normalizeRoute(route);
  const category: ErrorCategory = opts.category ?? "client_exception";

  const event: QueryGuardEvent = {
    event_id: generateId(),
    timestamp: now(),
    fingerprint:
      opts.fingerprint ??
      createFingerprint({
        category,
        entity: opts.entity,
        http_status: opts.httpStatus,
        route,
        message,
      }),

    // Project / Environment
    project_id: config.projectId,
    environment: config.environment,
    deploy_version: config.deployVersion,

    // Session
    session_id: getOrCreateSessionId(),

    // Tracing
    trace_id: opts.traceId,
    span_id: opts.spanId,
    parent_span_id: opts.parentSpanId,

    // Classification
    severity: opts.severity ?? "error",
    category,

    // Error
    message,
    stack: normalizeStack(stack),

    // HTTP
    http_method: opts.httpMethod,
    http_status: opts.httpStatus,

    // Route
    page_url: safePageUrl(),
    route,
    normalized_route: normalizedRoute,

    // Entity
    entity: opts.entity,

    // Performance
    duration_ms: opts.durationMs,

    // Scoring
    impact_score: computeImpactScore(normalizedRoute, opts.severity ?? "error", category, opts.httpStatus),

    // Context
    breadcrumbs: getBreadcrumbs(),
    user: opts.user,
    metadata: sanitizeMetadata(opts.metadata, config.redaction as Required<import("../types/index.js").RedactionConfig>),

    sdk: SDK_INFO,
  };

  return event;
}

// ─── Impact Scoring ───────────────────────────────────────────────────────────

const PAGE_CRITICALITY: Record<string, number> = {
  "/dashboard": 10,
  "/dashboard/learn": 9,
  "/dashboard/courses": 8,
  "/dashboard/jax": 8,
  "/dashboard/my-path": 7,
  "/checkout": 10,
  "/login": 6,
  "/signup": 6,
  "/admin": 3,
};

function routeCriticality(route: string): number {
  for (const [prefix, score] of Object.entries(PAGE_CRITICALITY)) {
    if (route.startsWith(prefix)) return score;
  }
  return 5; // default
}

const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  fatal: 4,
  error: 3,
  warn: 1.5,
  info: 1,
};

const STATUS_MULTIPLIER: Record<number, number> = {
  500: 3,
  503: 3,
  403: 2,
  401: 2,
  400: 1.5,
  404: 1,
};

function computeImpactScore(
  route: string,
  severity: Severity,
  category: ErrorCategory,
  httpStatus?: number
): number {
  const pageCrit = routeCriticality(route);
  const sevMult = SEVERITY_MULTIPLIER[severity] ?? 1;
  const statusMult = httpStatus ? (STATUS_MULTIPLIER[httpStatus] ?? 1) : 1;
  const typeMult = category === "rls_forbidden" ? 1.5 : 1;

  const raw = pageCrit * sevMult * statusMult * typeMult;
  // Normalize to 0–100
  const maxPossible = 10 * 4 * 3 * 1.5; // 180
  return Math.round(Math.min(100, (raw / maxPossible) * 100));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture an Error object.
 *
 * @example
 * ```ts
 * try {
 *   await supabase.from("orders").select("*");
 * } catch (err) {
 *   captureException(err, { entity: "orders" });
 * }
 * ```
 */
export function captureException(
  err: unknown,
  opts: CaptureOptions = {}
): string | undefined {
  if (!isInitialized()) return;

  let eventId: string | undefined;

  withCaptureGuard(() => {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    const event = buildEvent(message, stack, opts);
    eventId = event.event_id;
    getQueue().enqueue(event);
  });

  return eventId;
}

/**
 * Capture a plain message as an event.
 *
 * @example
 * ```ts
 * captureMessage("Empty result from user_profiles — user may not exist", {
 *   severity: "warn",
 *   category: "empty_result_anomaly",
 * });
 * ```
 */
export function captureMessage(
  message: string,
  opts: CaptureOptions = {}
): string | undefined {
  if (!isInitialized()) return;

  let eventId: string | undefined;

  withCaptureGuard(() => {
    const event = buildEvent(message, undefined, {
      severity: "info",
      category: "unknown",
      ...opts,
    });
    eventId = event.event_id;
    getQueue().enqueue(event);
  });

  return eventId;
}

// Export for internal use by instrumentation modules
export { buildEvent, withCaptureGuard };
