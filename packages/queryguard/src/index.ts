/**
 * queryguard — Main SDK Entry Point
 *
 * Re-exports the full public API.
 * Framework-specific entrypoints:
 *   queryguard/supabase  — Supabase instrumentation
 *   queryguard/react     — React ErrorBoundary + ErrorLogger
 *   queryguard/server    — Server/API-route helpers
 */

// ─── Init ─────────────────────────────────────────────────────────────────────
export {
  initQueryGuard,
  flushQueryGuard,
  resetQueryGuard,
  isInitialized,
  SDK_VERSION,
} from "./core/init.js";

// ─── Capture ──────────────────────────────────────────────────────────────────
export { captureException, captureMessage } from "./core/capture.js";
export type { CaptureOptions } from "./core/capture.js";

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────
export {
  addBreadcrumb,
  addNavigationBreadcrumb,
  addFetchBreadcrumb,
  addUserBreadcrumb,
  addCustomBreadcrumb,
  getBreadcrumbs,
  clearBreadcrumbs,
  attachBreadcrumbListeners,
} from "./core/breadcrumbs.js";

// ─── Fingerprinting ───────────────────────────────────────────────────────────
export {
  createFingerprint,
  createFingerprintFromParts,
  fingerprintEvent,
} from "./fingerprint/index.js";

// ─── Route / Entity Normalization ─────────────────────────────────────────────
export {
  normalizeRoute,
  normalizeStack,
  extractSupabaseEntity,
  classifySupabaseFamily,
  isSupabaseUrl,
} from "./normalize/index.js";

// ─── Redaction ────────────────────────────────────────────────────────────────
export {
  redactHeaders,
  redactBody,
  redactUrl,
  sanitizeMetadata,
  safeJsonStringify,
  DEFAULT_REDACTION_CONFIG,
} from "./redaction/index.js";

// ─── Client Capture ───────────────────────────────────────────────────────────
export { setupGlobalClientErrorCapture } from "./client/index.js";

// ─── Impact Scoring ───────────────────────────────────────────────────────────
export { computeImpactScore } from "./core/impact.js";

// ─── Utils ────────────────────────────────────────────────────────────────────
export {
  generateId,
  isBrowser,
  isServer,
  now,
  safePageUrl,
  getOrCreateSessionId,
} from "./utils/index.js";

// ─── Types (re-exported for consumers) ───────────────────────────────────────
export type {
  QueryGuardConfig,
  QueryGuardEvent,
  QueryGuardIssue,
  IngestionPayload,
  Severity,
  ErrorCategory,
  SupabaseRequestFamily,
  IssueStatus,
  Breadcrumb,
  BreadcrumbType,
  UserContext,
  SdkInfo,
  TraceContext,
  RedactionConfig,
} from "./types/index.js";
