/**
 * QueryGuard — Canonical Event Types
 *
 * This module defines the shared, strongly-typed event model used across
 * the SDK (instrumentation) and the dashboard (ingestion + display).
 * Every event flowing through QueryGuard conforms to QueryGuardEvent.
 */

// ─── Severity ───────────────────────────────────────────────────────────────

export type Severity = "fatal" | "error" | "warn" | "info";

export const SEVERITY_RANK: Record<Severity, number> = {
  fatal: 4,
  error: 3,
  warn: 2,
  info: 1,
};

// ─── Error Categories ────────────────────────────────────────────────────────

export type ErrorCategory =
  | "silent_query_failure"  // PostgREST non-throw 4xx/5xx
  | "rls_forbidden"         // 403 from RLS policy block
  | "slow_query"            // query exceeded duration threshold
  | "edge_function_error"   // Supabase edge function failure
  | "auth_failure"          // /auth/v1/ unexpected error
  | "empty_result_anomaly"  // [] returned where data expected
  | "rpc_failure"           // supabase.rpc() failed
  | "client_exception"      // unhandled JS exception
  | "unhandled_rejection"   // unhandled promise rejection
  | "network_error"         // fetch failed entirely
  | "server_error"          // API route / server action error
  | "canary_failure"        // heartbeat self-check failed
  | "unknown";              // catch-all

// ─── Supabase Request Family ─────────────────────────────────────────────────

export type SupabaseRequestFamily =
  | "postgrest"   // /rest/v1/
  | "auth"        // /auth/v1/
  | "storage"     // /storage/v1/
  | "functions"   // /functions/v1/
  | "realtime"    // /realtime/
  | "rpc"         // /rest/v1/rpc/
  | "unknown";

// ─── Breadcrumb ──────────────────────────────────────────────────────────────

export type BreadcrumbType =
  | "navigation"
  | "click"
  | "fetch"
  | "console"
  | "user"
  | "custom";

export interface Breadcrumb {
  type: BreadcrumbType;
  message: string;
  timestamp: string;          // ISO 8601
  data?: Record<string, unknown>;
}

// ─── User Context (privacy-safe) ─────────────────────────────────────────────

export interface UserContext {
  /** Opaque user identifier — never store email/PII directly */
  id?: string;
  /** Role for impact scoring context */
  role?: string;
}

// ─── SDK Info ────────────────────────────────────────────────────────────────

export interface SdkInfo {
  name: "queryguard";
  version: string;
  runtime: "browser" | "server" | "edge";
}

// ─── Trace Context ───────────────────────────────────────────────────────────

export interface TraceContext {
  /** Correlation ID linking a chain of related events */
  trace_id?: string;
  /** Individual span within a trace */
  span_id?: string;
  /** Parent span for hierarchical correlation */
  parent_span_id?: string;
}

// ─── Canonical QueryGuard Event ───────────────────────────────────────────────

export interface QueryGuardEvent {
  // Identity
  event_id: string;                     // UUID v4
  timestamp: string;                    // ISO 8601
  fingerprint: string;                  // deterministic grouping key

  // Project / Environment
  project_id?: string;                  // for future multi-project SaaS
  environment: string;                  // "production" | "staging" | "development"
  deploy_version?: string;              // git SHA or semver

  // Session
  session_id?: string;

  // Tracing
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;

  // Classification
  severity: Severity;
  category: ErrorCategory;
  supabase_family?: SupabaseRequestFamily;

  // Error detail
  message: string;
  stack?: string;

  // HTTP context
  http_method?: string;                 // GET | POST | PATCH | DELETE
  http_status?: number;                 // 200 | 403 | 500 etc.
  request_url?: string;                 // redacted — no tokens

  // Route context
  page_url?: string;                    // current page (redacted QS)
  route?: string;                       // raw path
  normalized_route?: string;            // /users/:id — dynamic segments replaced

  // Supabase entity
  entity?: string;                      // table name e.g. "user_profiles"

  // Performance
  duration_ms?: number;

  // Scoring
  impact_score?: number;                // computed 0–100

  // Context
  breadcrumbs?: Breadcrumb[];
  user?: UserContext;
  metadata?: Record<string, unknown>;   // safe, redacted extra data

  // SDK
  sdk: SdkInfo;
}

// ─── Ingestion Payload ────────────────────────────────────────────────────────

/** What the SDK POSTs to /api/error-log */
export interface IngestionPayload {
  events: QueryGuardEvent[];
  /** Optional ingestion API key for future hosted mode */
  api_key?: string;
}

// ─── Issue (grouped) ─────────────────────────────────────────────────────────

export type IssueStatus = "open" | "resolved" | "ignored" | "regressed";

export interface QueryGuardIssue {
  id: string;
  fingerprint: string;
  title: string;
  category: ErrorCategory;
  severity: Severity;
  status: IssueStatus;
  occurrence_count: number;
  affected_user_count: number;
  first_seen: string;
  last_seen: string;
  resolved_at?: string;
  entity?: string;
  normalized_route?: string;
  impact_score: number;
  environment: string;
  project_id?: string;
  // SLA
  sla_breach?: boolean;
  sla_deadline?: string;
  // Regression
  regression_count: number;
  // Latest breadcrumbs from most recent event
  last_breadcrumbs?: Breadcrumb[];
}

// ─── Init Config ─────────────────────────────────────────────────────────────

export interface QueryGuardConfig {
  /** URL of the ingestion endpoint. e.g. https://your-queryguard.com/api/error-log */
  endpoint: string;
  /** Optional API key for authenticated ingestion */
  apiKey?: string;
  /** project_id for future multi-project support */
  projectId?: string;
  /** "production" | "staging" | "development" — defaults to NODE_ENV */
  environment?: string;
  /** Git SHA or release version */
  deployVersion?: string;
  /** Max breadcrumbs to keep in memory (default: 30) */
  maxBreadcrumbs?: number;
  /** Slow query threshold in ms (default: 3000) */
  slowQueryThresholdMs?: number;
  /** Batch flush interval in ms (default: 2000) */
  flushIntervalMs?: number;
  /** Max events per batch (default: 20) */
  maxBatchSize?: number;
  /** Enable debug logging to console (default: false) */
  debug?: boolean;
  /** Custom redaction config */
  redaction?: RedactionConfig;
  /** Disable SDK entirely (useful for testing) */
  disabled?: boolean;
}

// ─── Redaction Config ────────────────────────────────────────────────────────

export interface RedactionConfig {
  /** Header names to redact (case-insensitive) */
  redactHeaders?: string[];
  /** Body field names to redact */
  redactBodyFields?: string[];
  /** Max metadata value length before truncation */
  maxMetadataValueLength?: number;
  /** Max body size to capture (bytes) — default 0 (no body logging) */
  maxBodySize?: number;
}
