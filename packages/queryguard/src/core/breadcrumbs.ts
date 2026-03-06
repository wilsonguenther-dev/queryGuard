/**
 * QueryGuard — Breadcrumb Store
 *
 * Maintains a rolling window of recent user/app activity.
 * Breadcrumbs are attached to every captured event for context.
 * Automatically collected from navigation, clicks, and fetch calls.
 */

import type { Breadcrumb, BreadcrumbType } from "../types/index.js";
import { now } from "../utils/index.js";

// ─── In-memory store ─────────────────────────────────────────────────────────

let _breadcrumbs: Breadcrumb[] = [];
let _maxBreadcrumbs = 30;
let _listenersAttached = false;

export function configureBreadcrumbs(maxBreadcrumbs: number): void {
  _maxBreadcrumbs = maxBreadcrumbs;
}

// ─── Core operations ─────────────────────────────────────────────────────────

export function addBreadcrumb(
  type: BreadcrumbType,
  message: string,
  data?: Record<string, unknown>
): void {
  const crumb: Breadcrumb = {
    type,
    message,
    timestamp: now(),
    ...(data ? { data } : {}),
  };

  _breadcrumbs.push(crumb);

  // Enforce max size — drop oldest
  if (_breadcrumbs.length > _maxBreadcrumbs) {
    _breadcrumbs = _breadcrumbs.slice(_breadcrumbs.length - _maxBreadcrumbs);
  }
}

/** Get a snapshot of current breadcrumbs (newest last) */
export function getBreadcrumbs(): Breadcrumb[] {
  return [..._breadcrumbs];
}

/** Clear all breadcrumbs */
export function clearBreadcrumbs(): void {
  _breadcrumbs = [];
}

// ─── Auto-collection (browser only) ─────────────────────────────────────────

/**
 * Attach global listeners to auto-collect navigation, click, and fetch crumbs.
 * Safe to call in SSR (no-ops on server). Idempotent.
 */
export function attachBreadcrumbListeners(maxBreadcrumbs?: number): (() => void) {
  if (typeof window === "undefined") return () => {};
  if (_listenersAttached) return () => {};

  if (maxBreadcrumbs !== undefined) {
    _maxBreadcrumbs = maxBreadcrumbs;
  }

  // Navigation — popstate (SPA navigation)
  const handlePopState = () => {
    addBreadcrumb("navigation", `Navigated to ${location.pathname}`);
  };

  // Click — capture element label for context
  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const label =
      target.getAttribute("aria-label") ||
      target.textContent?.trim().slice(0, 60) ||
      target.tagName.toLowerCase();
    addBreadcrumb("click", `Clicked: ${label}`);
  };

  window.addEventListener("popstate", handlePopState);
  window.addEventListener("click", handleClick, { capture: true, passive: true });

  _listenersAttached = true;

  // Return cleanup function
  return () => {
    window.removeEventListener("popstate", handlePopState);
    window.removeEventListener("click", handleClick, { capture: true });
    _listenersAttached = false;
  };
}

// ─── Manual breadcrumb helpers ────────────────────────────────────────────────

export function addNavigationBreadcrumb(to: string): void {
  addBreadcrumb("navigation", `Navigated to ${to}`);
}

export function addFetchBreadcrumb(
  method: string,
  url: string,
  status?: number,
  durationMs?: number
): void {
  const statusStr = status ? ` → ${status}` : "";
  const durationStr = durationMs ? ` (${durationMs}ms)` : "";
  addBreadcrumb("fetch", `${method} ${url}${statusStr}${durationStr}`, {
    method,
    url,
    status,
    duration_ms: durationMs,
  });
}

export function addUserBreadcrumb(message: string, data?: Record<string, unknown>): void {
  addBreadcrumb("user", message, data);
}

export function addCustomBreadcrumb(message: string, data?: Record<string, unknown>): void {
  addBreadcrumb("custom", message, data);
}
