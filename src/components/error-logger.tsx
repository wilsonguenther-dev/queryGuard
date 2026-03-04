"use client";

import { useEffect } from "react";
import { getBreadcrumbs, initBreadcrumbTracker } from "@/lib/supabase/breadcrumb-tracker";
import { startCanary } from "@/lib/supabase/query-guard";

/**
 * Global error logger — catches unhandled errors and promise rejections
 * and logs them to /api/error-log for admin debugging.
 * Mount this once in the root layout.
 *
 * QueryGuard v2 integrations:
 * - Breadcrumbs: attaches event trail to every error
 * - Canary: starts the self-check heartbeat
 * - Session/deploy context: attached to every log
 */
export function ErrorLogger() {
  useEffect(() => {
    // Initialize breadcrumb tracking + canary on mount
    initBreadcrumbTracker();
    startCanary();

    // Known benign errors that should NOT be logged — they're framework/browser
    // artifacts, not actionable bugs. Logging them only creates noise.
    const SUPPRESSED_PATTERNS = [
      // React SSR streaming hydration: $RS/$RC try to swap Suspense placeholders
      // that may have been removed by navigation or DOM mutation. Benign.
      /\$R[SC]\b/,
      /Cannot read properties of null \(reading 'parentNode'\)/,
      // React hydration mismatch warnings (not errors)
      /Hydration failed because/,
      /There was an error while hydrating/,
      /Text content does not match/,
      // Browser noise — ResizeObserver loop is a known non-issue
      /ResizeObserver loop/,
    ];

    function isSuppressed(message: string, stack?: string): boolean {
      const text = `${message} ${stack || ""}`;
      return SUPPRESSED_PATTERNS.some(p => p.test(text));
    }

    function logError(payload: {
      error_message: string;
      error_stack?: string;
      component_name?: string;
      page_url?: string;
      severity?: string;
      metadata?: Record<string, unknown>;
    }) {
      // Skip known benign errors
      if (isSuppressed(payload.error_message, payload.error_stack)) return;

      // Attach breadcrumbs to every error for debugging context
      const breadcrumbs = getBreadcrumbs();

      fetch("/api/error-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          page_url: payload.page_url || window.location.href,
          error_type: "client_error",
          metadata: {
            ...payload.metadata,
            pathname: window.location.pathname,
            search: window.location.search,
            referrer: document.referrer || null,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            timestamp_local: new Date().toISOString(),
            breadcrumbs: breadcrumbs.length > 0 ? breadcrumbs : undefined,
          },
        }),
      }).catch(() => {});
    }

    function handleError(event: ErrorEvent) {
      logError({
        error_message: event.message || "Unknown error",
        error_stack: event.error?.stack || "",
        component_name: event.filename || undefined,
        severity: "error",
        metadata: { lineno: event.lineno, colno: event.colno },
      });
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      logError({
        error_message: reason?.message || String(reason) || "Unhandled promise rejection",
        error_stack: reason?.stack || "",
        severity: "error",
        metadata: { type: "unhandled_rejection" },
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
