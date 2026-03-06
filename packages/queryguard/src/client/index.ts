/**
 * QueryGuard — Client-Side Error Capture
 *
 * Attaches global error handlers and sets up breadcrumb collection.
 * SSR-safe — all browser API access is guarded.
 * Call setupGlobalClientErrorCapture() once in your client root.
 */

import { captureException } from "../core/capture.js";
import { attachBreadcrumbListeners, addBreadcrumb } from "../core/breadcrumbs.js";
import { isInitialized } from "../core/init.js";

let _cleanupFns: Array<() => void> = [];
let _attached = false;

/**
 * Attach global window error handlers and breadcrumb listeners.
 * Safe to call server-side (no-ops if window is undefined).
 * Idempotent — calling twice does nothing.
 *
 * @returns cleanup function — call on unmount/test teardown
 */
export function setupGlobalClientErrorCapture(): () => void {
  if (typeof window === "undefined") return () => {};
  if (_attached) return () => cleanup();

  // ── window.onerror ───────────────────────────────────────────────────────
  const prevOnerror = window.onerror;

  window.onerror = function (message, source, lineno, colno, error) {
    if (isInitialized()) {
      captureException(error ?? String(message), {
        category: "client_exception",
        severity: "error",
        metadata: {
          source: String(source ?? ""),
          lineno,
          colno,
        },
      });
    }
    // Call previous handler if any
    if (typeof prevOnerror === "function") {
      return prevOnerror.call(this, message, source, lineno, colno, error);
    }
    return false;
  };

  _cleanupFns.push(() => {
    window.onerror = prevOnerror;
  });

  // ── unhandledrejection ───────────────────────────────────────────────────
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isInitialized()) return;
    const reason = event.reason;
    captureException(reason ?? "Unhandled promise rejection", {
      category: "unhandled_rejection",
      severity: "error",
    });
  };

  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  _cleanupFns.push(() => {
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  });

  // ── Breadcrumbs ──────────────────────────────────────────────────────────
  const cleanupCrumbs = attachBreadcrumbListeners();
  _cleanupFns.push(cleanupCrumbs);

  // ── Initial navigation breadcrumb ────────────────────────────────────────
  addBreadcrumb("navigation", `Initial load: ${location.pathname}`);

  _attached = true;

  return () => cleanup();
}

function cleanup(): void {
  for (const fn of _cleanupFns) {
    try { fn(); } catch {}
  }
  _cleanupFns = [];
  _attached = false;
}
