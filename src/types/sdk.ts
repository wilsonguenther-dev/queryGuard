/**
 * Re-exports SDK types for use inside the dashboard app.
 * The dashboard app imports these directly rather than building
 * the SDK package just to get the types during development.
 */
export type {
  QueryGuardEvent,
  QueryGuardIssue,
  QueryGuardConfig,
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
} from "../../packages/queryguard/src/types/index.js";
