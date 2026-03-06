/**
 * QueryGuard — Supabase Instrumentation
 *
 * Drop-in fetch wrapper that intercepts all Supabase traffic:
 * PostgREST queries, RPC calls, Auth endpoints, Edge Functions, Storage.
 *
 * Usage:
 *   import { createGuardedFetch } from "queryguard/supabase";
 *   const guardedFetch = createGuardedFetch();
 *
 *   // Browser client
 *   createBrowserClient(url, key, { global: { fetch: guardedFetch } });
 *
 *   // Server client
 *   createServerClient(url, key, { global: { fetch: guardedFetch }, cookies });
 */

import type {
  QueryGuardEvent,
  ErrorCategory,
  Severity,
} from "../types/index.js";
import {
  extractSupabaseEntity,
  classifySupabaseFamily,
  isSupabaseUrl,
  normalizeRoute,
  normalizeMethod,
} from "../normalize/index.js";
import { createFingerprint } from "../fingerprint/index.js";
import { redactUrl } from "../redaction/index.js";
import { generateId, now, safePageUrl, getOrCreateSessionId } from "../utils/index.js";
import { getConfig, getQueue, isInitialized, SDK_INFO } from "../core/init.js";
import { getBreadcrumbs, addFetchBreadcrumb } from "../core/breadcrumbs.js";
import { computeImpactScore } from "../core/impact.js";
import { withCaptureGuard } from "../core/capture.js";

// ─── Classification Helpers ────────────────────────────────────────────────

function classifyCategory(
  family: ReturnType<typeof classifySupabaseFamily>,
  status: number,
  isEmpty: boolean,
  durationMs: number,
  slowThreshold: number
): ErrorCategory | null {
  // Slow query — report even on success
  if (durationMs >= slowThreshold && (family === "postgrest" || family === "rpc")) {
    return "slow_query";
  }

  // Empty result anomaly on successful reads
  if (isEmpty && status === 200 && family === "postgrest") {
    return "empty_result_anomaly";
  }

  // Not a failure — nothing to report
  if (status < 400) return null;

  switch (family) {
    case "auth":
      return "auth_failure";
    case "functions":
      return status >= 500 ? "edge_function_error" : "edge_function_error";
    case "rpc":
      return "rpc_failure";
    case "postgrest":
      if (status === 403) return "rls_forbidden";
      return "silent_query_failure";
    default:
      return status >= 400 ? "silent_query_failure" : null;
  }
}

function classifySeverity(status: number, category: ErrorCategory): Severity {
  if (status >= 500) return "error";
  if (status === 403) return "warn";
  if (status === 401) return "warn";
  if (category === "slow_query") return "warn";
  if (category === "empty_result_anomaly") return "info";
  if (status >= 400) return "error";
  return "info";
}

// ─── Empty Result Detection ────────────────────────────────────────────────

async function isEmptyResult(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  // Clone so we don't consume the body
  try {
    const clone = response.clone();
    const text = await clone.text();
    const trimmed = text.trim();
    return trimmed === "[]" || trimmed === "null";
  } catch {
    return false;
  }
}

// ─── Event Builder ─────────────────────────────────────────────────────────

function buildSupabaseEvent(opts: {
  category: ErrorCategory;
  severity: Severity;
  message: string;
  url: string;
  method: string;
  status: number;
  durationMs: number;
  entity?: string;
  family: ReturnType<typeof classifySupabaseFamily>;
}): QueryGuardEvent {
  const config = getConfig();
  const route = safePageUrl();
  const normalizedRoute = normalizeRoute(route);

  const event: QueryGuardEvent = {
    event_id: generateId(),
    timestamp: now(),
    fingerprint: createFingerprint({
      category: opts.category,
      entity: opts.entity,
      http_status: opts.status,
      route,
      message: opts.message,
    }),

    project_id: config.projectId,
    environment: config.environment,
    deploy_version: config.deployVersion,
    session_id: getOrCreateSessionId(),

    severity: opts.severity,
    category: opts.category,
    supabase_family: opts.family,

    message: opts.message,

    http_method: opts.method,
    http_status: opts.status,
    request_url: redactUrl(opts.url),

    page_url: route,
    route,
    normalized_route: normalizedRoute,

    entity: opts.entity,
    duration_ms: opts.durationMs,

    impact_score: computeImpactScore(normalizedRoute, opts.severity, opts.category, opts.status),

    breadcrumbs: getBreadcrumbs(),

    sdk: SDK_INFO,
  };

  return event;
}

// ─── createGuardedFetch ────────────────────────────────────────────────────

export interface GuardedFetchOptions {
  /** Override to use a specific Supabase URL for isSupabaseUrl check */
  supabaseUrl?: string;
  /** Override the slow query threshold (ms). Falls back to SDK config. */
  slowQueryThresholdMs?: number;
}

/**
 * Create a fetch wrapper that instruments all Supabase API traffic.
 * Pass the returned function as the `global.fetch` option in your Supabase client.
 *
 * @example
 * ```ts
 * import { createGuardedFetch } from "queryguard/supabase";
 *
 * const guardedFetch = createGuardedFetch({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
 *
 * export const supabase = createBrowserClient(url, key, {
 *   global: { fetch: guardedFetch },
 * });
 * ```
 */
export function createGuardedFetch(opts: GuardedFetchOptions = {}): typeof fetch {
  return async function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = normalizeMethod(init?.method);
    const start = Date.now();

    // Pass through immediately if SDK not initialized or not a Supabase URL
    if (!isInitialized() || !isSupabaseUrl(url, opts.supabaseUrl)) {
      return fetch(input, init);
    }

    const family = classifySupabaseFamily(url);
    const entity = extractSupabaseEntity(url);

    let response: Response;

    try {
      response = await fetch(input, init);
    } catch (networkErr) {
      // Network-level failure — fetch didn't return at all
      const durationMs = Date.now() - start;

      withCaptureGuard(() => {
        const event = buildSupabaseEvent({
          category: "network_error",
          severity: "error",
          message: networkErr instanceof Error ? networkErr.message : "Network request failed",
          url,
          method,
          status: 0,
          durationMs,
          entity,
          family,
        });
        getQueue().enqueue(event);
      });

      addFetchBreadcrumb(method, redactUrl(url) ?? url, 0, durationMs);
      throw networkErr;
    }

    const durationMs = Date.now() - start;
    const config = getConfig();
    const slowThreshold = opts.slowQueryThresholdMs ?? config.slowQueryThresholdMs;

    // Add breadcrumb for ALL Supabase calls
    addFetchBreadcrumb(method, redactUrl(url) ?? url, response.status, durationMs);

    // Determine if this is worth reporting
    const isEmpty = method === "GET" ? await isEmptyResult(response) : false;
    const category = classifyCategory(family, response.status, isEmpty, durationMs, slowThreshold);

    if (category !== null) {
      withCaptureGuard(() => {
        const statusText = response.statusText || String(response.status);
        const entityLabel = entity ? ` ${entity}` : "";
        const message = `${method}${entityLabel} → ${response.status} ${statusText}`;

        const severity = classifySeverity(response.status, category);

        const event = buildSupabaseEvent({
          category,
          severity,
          message,
          url,
          method,
          status: response.status,
          durationMs,
          entity,
          family,
        });

        getQueue().enqueue(event);
      });
    }

    return response;
  };
}

/**
 * Pre-built guarded fetch — uses SDK config automatically.
 * Equivalent to createGuardedFetch() with no options.
 *
 * @example
 * ```ts
 * import { guardedFetch } from "queryguard/supabase";
 * createBrowserClient(url, key, { global: { fetch: guardedFetch } });
 * ```
 */
export const guardedFetch = createGuardedFetch();

/**
 * Server-side alias — identical behavior, just a named export for clarity.
 */
export const serverGuardedFetch = createGuardedFetch();

/**
 * Higher-order wrapper: takes a Supabase client factory and returns
 * a version that automatically instruments all traffic.
 *
 * @example
 * ```ts
 * import { createBrowserClient } from "@supabase/ssr";
 * import { withQueryGuardSupabase } from "queryguard/supabase";
 *
 * export const createClient = withQueryGuardSupabase(
 *   (guardedFetch) => createBrowserClient(url, key, { global: { fetch: guardedFetch } })
 * );
 * ```
 */
export function withQueryGuardSupabase<T>(
  factory: (guardedFetch: typeof fetch) => T,
  opts: GuardedFetchOptions = {}
): T {
  return factory(createGuardedFetch(opts));
}
