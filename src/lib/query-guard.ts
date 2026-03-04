/**
 * QueryGuard v2 — Full Observability Engine
 * ==========================================
 * Intercepts ALL Supabase traffic (REST, edge functions, auth) and detects:
 * - Silent query failures (4xx/5xx from PostgREST)
 * - Edge function errors
 * - Auth failures (broken token refresh)
 * - Slow queries (> 3s)
 * - Empty result anomalies (200 with [] on expected-data queries)
 * - RPC failures (separate from table queries)
 *
 * Features:
 * - Fingerprinting + deduplication (same error → 1 issue, not 200 rows)
 * - Impact scoring (dashboard errors > admin errors)
 * - Deploy version correlation (NEXT_PUBLIC_DEPLOY_SHA)
 * - Session tracking (session_id + page count)
 * - Batched async logging (zero perf impact)
 * - Server-side DB logging (not just console.error)
 * - Canary self-check (verifies guard is running)
 * - Never throws — logging failure never breaks the app
 */

// ── Constants ──────────────────────────────────────────────────
const DEPLOY_VERSION =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_DEPLOY_SHA || process.env.VERCEL_GIT_COMMIT_SHA || ""
    : typeof window !== "undefined"
      ? (window as any).__NEXT_DATA__?.buildId || ""
      : "";

const SLOW_QUERY_THRESHOLD_MS = 3000;
const SLOW_QUERY_CRITICAL_MS = 5000;

// Tables where empty results from a logged-in user are suspicious
const EXPECTED_DATA_TABLES = new Set([
  "lesson_progress", "learning_paths", "user_profiles", "enrollments",
  "notifications", "achievements", "user_achievements",
]);

// Journey criticality scores for impact calculation
const PAGE_CRITICALITY: Record<string, number> = {
  "/dashboard": 10,
  "/dashboard/learn": 9,
  "/dashboard/courses": 8,
  "/dashboard/jax": 7,
  "/dashboard/channels": 6,
  "/dashboard/tools": 5,
  "/dashboard/account": 4,
  "/admin": 3,
  "/instructor": 4,
  "/enterprise": 5,
};

// ── Session tracking ───────────────────────────────────────────
let sessionId = "";
let sessionPageCount = 0;

if (typeof window !== "undefined") {
  sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Track page navigations
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    sessionPageCount++;
    return origPushState.apply(this, args);
  };
}

// ── Fingerprinting ─────────────────────────────────────────────
function generateFingerprint(
  errorType: string,
  entity: string,
  status: number,
  pagePath: string,
  pgError: string
): string {
  // Normalize the page path (remove dynamic segments like UUIDs/slugs)
  const normalizedPath = pagePath
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/[a-z0-9-]{20,}/gi, "/:slug");
  // Extract the core error (first line, no specifics)
  const coreError = pgError.split("\n")[0].slice(0, 100);
  const raw = `${errorType}|${entity}|${status}|${normalizedPath}|${coreError}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `qg_${Math.abs(hash).toString(36)}`;
}

// ── Impact scoring ─────────────────────────────────────────────
function calculateImpact(pagePath: string, status: number, errorType: string): number {
  // Base: journey criticality (1-10)
  let criticality = 1;
  for (const [prefix, score] of Object.entries(PAGE_CRITICALITY)) {
    if (pagePath.startsWith(prefix)) { criticality = score; break; }
  }
  // Severity multiplier
  const severityMult = status >= 500 ? 3 : status === 403 ? 2 : status === 400 ? 1.5 : 1;
  // Type multiplier
  const typeMult = errorType === "silent_query_failure" ? 2 : errorType === "slow_query" ? 1.5 : 1;
  return Math.round(criticality * severityMult * typeMult * 10) / 10;
}

// ── Human-readable labels ──────────────────────────────────────
function getStatusLabel(status: number): string {
  switch (status) {
    case 400: return "Bad Request (wrong column/filter?)";
    case 401: return "Unauthorized (expired token?)";
    case 403: return "Forbidden (RLS policy?)";
    case 404: return "Not Found (missing table/view?)";
    case 409: return "Conflict (unique constraint?)";
    case 422: return "Unprocessable (validation error?)";
    case 429: return "Rate Limited";
    default: return status >= 500 ? `Server Error ${status}` : `HTTP ${status}`;
  }
}

function getSeverity(status: number): string {
  if (status >= 500) return "fatal";
  if (status === 403) return "warn";
  if (status === 429) return "warn";
  return "error";
}

// ── URL parsing helpers ────────────────────────────────────────
function extractEntity(url: string): { entity: string; isRpc: boolean } {
  const rpcMatch = url.match(/\/rest\/v1\/rpc\/([^?]+)/);
  if (rpcMatch) return { entity: `rpc/${rpcMatch[1]}`, isRpc: true };
  const tableMatch = url.match(/\/rest\/v1\/([^?/]+)/);
  if (tableMatch) return { entity: tableMatch[1], isRpc: false };
  return { entity: "unknown", isRpc: false };
}

function extractEdgeFnName(url: string): string | null {
  const match = url.match(/\/functions\/v1\/([^?/]+)/);
  return match ? match[1] : null;
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  try {
    const u = new URL(url);
    u.searchParams.forEach((v, k) => {
      params[k] = v.length > 200 ? v.slice(0, 200) + "…" : v;
    });
  } catch {}
  return params;
}

function parseErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed.message || parsed.msg || parsed.hint || parsed.error || "";
  } catch {
    return body.slice(0, 300);
  }
}

// ── Deduplication ──────────────────────────────────────────────
const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);
const seen = new Set<string>();

if (typeof window !== "undefined") {
  setInterval(() => seen.clear(), 5 * 60 * 1000);
}

// ── Batched error queue ────────────────────────────────────────
let queue: Record<string, unknown>[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, 15);
  for (const entry of batch) {
    nativeFetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {});
  }
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, 2000);
}

function enqueue(entry: Record<string, unknown>) {
  queue.push(entry);
  scheduleFlush();
}

// ── Core: Build error payload ──────────────────────────────────
function buildPayload(opts: {
  errorType: string;
  entity: string;
  method: string;
  status: number;
  pgError: string;
  url: string;
  params?: Record<string, string>;
  requestBody?: string | null;
  durationMs?: number;
  extraMeta?: Record<string, unknown>;
}): Record<string, unknown> {
  const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
  const label = getStatusLabel(opts.status);
  const severity = getSeverity(opts.status);
  const fingerprint = generateFingerprint(opts.errorType, opts.entity, opts.status, pagePath, opts.pgError);
  const impact = calculateImpact(pagePath, opts.status, opts.errorType);

  return {
    error_message: `[QueryGuard] ${opts.method} ${opts.entity} → ${opts.status} ${label}`,
    component_name: "supabase/query-guard",
    page_url: typeof window !== "undefined" ? window.location.href : "",
    severity,
    fingerprint,
    impact_score: impact,
    deploy_version: DEPLOY_VERSION,
    session_id: sessionId,
    error_type: opts.errorType,
    duration_ms: opts.durationMs || null,
    metadata: {
      type: opts.errorType,
      table: opts.entity,
      http_status: opts.status,
      http_status_text: label,
      http_method: opts.method,
      pg_error: opts.pgError.slice(0, 500),
      query_params: opts.params || {},
      request_body: opts.requestBody ? opts.requestBody.slice(0, 500) : null,
      duration_ms: opts.durationMs || null,
      session_page_count: sessionPageCount,
      ...opts.extraMeta,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// CLIENT-SIDE GUARDED FETCH
// Upgrades: #1-5, #7, #9-10, #12-13
// ══════════════════════════════════════════════════════════════
export function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

  return nativeFetch(input, init).then(async (res) => {
    const url = extractUrl(input);
    const method = init?.method || "GET";
    const durationMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startTime
    );

    // ── Upgrade #4: Slow query detection (200 but took too long) ──
    if (res.ok && url.includes("/rest/v1/") && durationMs > SLOW_QUERY_THRESHOLD_MS) {
      const { entity } = extractEntity(url);
      const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
      const dedupKey = `slow:${entity}:${pagePath}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        const severity = durationMs > SLOW_QUERY_CRITICAL_MS ? "error" : "warn";
        enqueue({
          error_message: `[QueryGuard] SLOW ${method} ${entity} → ${durationMs}ms`,
          component_name: "supabase/query-guard",
          page_url: typeof window !== "undefined" ? window.location.href : "",
          severity,
          fingerprint: generateFingerprint("slow_query", entity, 200, pagePath, `${durationMs}ms`),
          impact_score: calculateImpact(pagePath, 200, "slow_query"),
          deploy_version: DEPLOY_VERSION,
          session_id: sessionId,
          error_type: "slow_query",
          duration_ms: durationMs,
          metadata: {
            type: "slow_query",
            table: entity,
            http_status: 200,
            http_method: method,
            duration_ms: durationMs,
            threshold_ms: SLOW_QUERY_THRESHOLD_MS,
            query_params: parseQueryParams(url),
          },
        });
      }
    }

    // ── Upgrade #5: Empty result anomaly (200 + [] on expected-data table) ──
    if (res.ok && url.includes("/rest/v1/") && method === "GET") {
      try {
        const { entity } = extractEntity(url);
        if (EXPECTED_DATA_TABLES.has(entity)) {
          const cloned = res.clone();
          const text = await cloned.text();
          if (text === "[]" || text === "null") {
            const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
            const dedupKey = `empty:${entity}:${pagePath}`;
            if (!seen.has(dedupKey)) {
              seen.add(dedupKey);
              enqueue({
                error_message: `[QueryGuard] EMPTY ${method} ${entity} → returned [] (expected data)`,
                component_name: "supabase/query-guard",
                page_url: typeof window !== "undefined" ? window.location.href : "",
                severity: "warn",
                fingerprint: generateFingerprint("empty_result", entity, 200, pagePath, "empty"),
                impact_score: calculateImpact(pagePath, 200, "empty_result"),
                deploy_version: DEPLOY_VERSION,
                session_id: sessionId,
                error_type: "empty_result",
                metadata: {
                  type: "empty_result",
                  table: entity,
                  http_status: 200,
                  http_method: method,
                  query_params: parseQueryParams(url),
                  note: "Query returned empty results on a table expected to have user data",
                },
              });
            }
          }
        }
      } catch {}
    }

    // ── Only process failures from here ──
    if (res.status < 400) return res;

    // ── Upgrade #2: Edge function monitoring ──
    const edgeFn = extractEdgeFnName(url);
    if (edgeFn) {
      const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
      const dedupKey = `edge:${edgeFn}:${res.status}:${pagePath}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        try {
          const cloned = res.clone();
          const body = await cloned.text();
          const pgError = parseErrorBody(body);
          enqueue(buildPayload({
            errorType: "edge_function_failure",
            entity: `fn/${edgeFn}`,
            method,
            status: res.status,
            pgError,
            url,
            durationMs,
            extraMeta: { function_name: edgeFn },
          }));
        } catch {}
      }
      return res;
    }

    // ── Upgrade #3: Auth error monitoring ──
    if (url.includes("/auth/v1/") && res.status !== 401) {
      // 401 on login is expected; other auth failures are suspicious
      const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
      const dedupKey = `auth:${res.status}:${pagePath}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        try {
          const cloned = res.clone();
          const body = await cloned.text();
          const pgError = parseErrorBody(body);
          enqueue(buildPayload({
            errorType: "auth_failure",
            entity: "auth",
            method,
            status: res.status,
            pgError,
            url: url.replace(/apikey=[^&]+/, "apikey=***"),
            durationMs,
          }));
        } catch {}
      }
      return res;
    }

    // ── PostgREST failures (/rest/v1/) ──
    if (!url.includes("/rest/v1/")) return res;

    try {
      const cloned = res.clone();
      const body = await cloned.text();
      const { entity, isRpc } = extractEntity(url);
      const pagePath = typeof window !== "undefined" ? window.location.pathname : "";
      const dedupKey = `${method}:${entity}:${res.status}:${pagePath}`;

      if (seen.has(dedupKey)) return res;
      seen.add(dedupKey);

      const pgError = parseErrorBody(body);
      const params = parseQueryParams(url);

      // Upgrade #7: Separate RPC failures
      const errorType = isRpc ? "rpc_failure" : "silent_query_failure";

      enqueue(buildPayload({
        errorType,
        entity,
        method,
        status: res.status,
        pgError,
        url,
        params,
        requestBody: init?.body ? String(init.body) : null,
        durationMs,
        extraMeta: isRpc ? { is_rpc: true } : {},
      }));
    } catch {}

    return res;
  });
}

// ══════════════════════════════════════════════════════════════
// SERVER-SIDE GUARDED FETCH
// Upgrade #1: Logs to DB via direct insert, not just console.error
// ══════════════════════════════════════════════════════════════
export function serverGuardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const startTime = Date.now();

  return globalThis.fetch(input, init).then(async (res) => {
    const url = extractUrl(input);
    const method = init?.method || "GET";
    const durationMs = Date.now() - startTime;

    // Slow query detection on server too
    if (res.ok && url.includes("/rest/v1/") && durationMs > SLOW_QUERY_THRESHOLD_MS) {
      const { entity } = extractEntity(url);
      console.warn(
        `⚠️ [QueryGuard:Server] SLOW ${method} ${entity} → ${durationMs}ms`
      );
    }

    if (res.status < 400) return res;

    const isRest = url.includes("/rest/v1/");
    const edgeFn = extractEdgeFnName(url);
    const isAuth = url.includes("/auth/v1/");

    if (!isRest && !edgeFn && !isAuth) return res;

    try {
      const cloned = res.clone();
      const body = await cloned.text();
      const pgError = parseErrorBody(body);

      let entity = "unknown";
      let errorType = "server_error";

      if (isRest) {
        const parsed = extractEntity(url);
        entity = parsed.entity;
        errorType = parsed.isRpc ? "rpc_failure" : "silent_query_failure";
      } else if (edgeFn) {
        entity = `fn/${edgeFn}`;
        errorType = "edge_function_failure";
      } else if (isAuth) {
        entity = "auth";
        errorType = "auth_failure";
      }

      const severity = getSeverity(res.status);
      const label = getStatusLabel(res.status);

      console.error(
        `\n🔴 [QueryGuard:Server] ${method} ${entity} → ${res.status} (${durationMs}ms)\n` +
          `   Error: ${pgError}\n` +
          `   URL: ${url.replace(/apikey=[^&]+/, "apikey=***")}\n`
      );

      // Upgrade #1: Log to DB via internal API
      // Use a direct fetch to the error-log endpoint (server-side)
      try {
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";
        globalThis.fetch(`${baseUrl}/api/error-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error_message: `[QueryGuard:Server] ${method} ${entity} → ${res.status} ${label}`,
            component_name: "supabase/query-guard-server",
            severity,
            error_type: errorType,
            deploy_version: DEPLOY_VERSION,
            duration_ms: durationMs,
            metadata: {
              type: errorType,
              table: entity,
              http_status: res.status,
              http_method: method,
              pg_error: pgError.slice(0, 500),
              duration_ms: durationMs,
              server_side: true,
            },
          }),
        }).catch(() => {});
      } catch {}
    } catch {}

    return res;
  });
}

// ══════════════════════════════════════════════════════════════
// Upgrade #25: Canary self-check
// ══════════════════════════════════════════════════════════════
let canaryInterval: ReturnType<typeof setInterval> | null = null;

export function startCanary() {
  if (typeof window === "undefined") return;
  if (canaryInterval) return;
  // Send canary every 6 hours
  canaryInterval = setInterval(() => {
    nativeFetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error_message: "[QueryGuard] Canary — guard is alive",
        component_name: "supabase/query-guard",
        page_url: typeof window !== "undefined" ? window.location.href : "",
        severity: "info",
        error_type: "canary",
        deploy_version: DEPLOY_VERSION,
        session_id: sessionId,
        metadata: { type: "canary", timestamp: new Date().toISOString() },
      }),
    }).catch(() => {});
  }, 6 * 60 * 60 * 1000);
  // Also send one immediately on first load
  setTimeout(() => {
    nativeFetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error_message: "[QueryGuard] Canary — guard initialized",
        component_name: "supabase/query-guard",
        page_url: typeof window !== "undefined" ? window.location.href : "",
        severity: "info",
        error_type: "canary",
        deploy_version: DEPLOY_VERSION,
        session_id: sessionId,
        metadata: { type: "canary", timestamp: new Date().toISOString(), event: "init" },
      }),
    }).catch(() => {});
  }, 10000);
}
