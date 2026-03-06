/**
 * QueryGuard — Impact Scoring
 *
 * Scores issues by journey criticality × severity × error type.
 * Higher score = higher priority triage.
 * Scale: 0–100.
 */

import type { Severity, ErrorCategory } from "../types/index.js";

// ─── Page criticality ────────────────────────────────────────────────────────

const PAGE_CRITICALITY: Array<[string, number]> = [
  ["/checkout", 10],
  ["/dashboard/learn", 9],
  ["/dashboard/courses", 8],
  ["/dashboard/jax", 8],
  ["/dashboard/my-path", 7],
  ["/dashboard", 10],
  ["/login", 6],
  ["/signup", 6],
  ["/onboarding", 6],
  ["/admin", 3],
  ["/api", 5],
];

function routeCriticality(route: string): number {
  for (const [prefix, score] of PAGE_CRITICALITY) {
    if (route.startsWith(prefix)) return score;
  }
  return 5;
}

// ─── Multipliers ──────────────────────────────────────────────────────────────

const SEVERITY_MULTIPLIER: Record<Severity, number> = {
  fatal: 4,
  error: 3,
  warn: 1.5,
  info: 1,
};

const STATUS_MULTIPLIER: Partial<Record<number, number>> = {
  500: 3,
  503: 3,
  502: 2.5,
  403: 2,
  401: 2,
  400: 1.5,
  404: 1,
};

const CATEGORY_MULTIPLIER: Partial<Record<ErrorCategory, number>> = {
  rls_forbidden: 1.5,
  edge_function_error: 1.4,
  auth_failure: 1.3,
  slow_query: 0.8,         // slow but not broken
  empty_result_anomaly: 0.6,
};

// Max theoretical score = 10 * 4 * 3 * 1.5 = 180
const MAX_SCORE = 180;

/**
 * Compute a 0–100 impact score for an event.
 */
export function computeImpactScore(
  normalizedRoute: string,
  severity: Severity,
  category: ErrorCategory,
  httpStatus?: number
): number {
  const pageCrit = routeCriticality(normalizedRoute);
  const sevMult = SEVERITY_MULTIPLIER[severity] ?? 1;
  const statusMult = httpStatus ? (STATUS_MULTIPLIER[httpStatus] ?? 1) : 1;
  const catMult = CATEGORY_MULTIPLIER[category] ?? 1;

  const raw = pageCrit * sevMult * statusMult * catMult;
  return Math.round(Math.min(100, (raw / MAX_SCORE) * 100));
}
