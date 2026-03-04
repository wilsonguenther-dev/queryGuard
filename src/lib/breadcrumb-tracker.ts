/**
 * Breadcrumb Tracker — Upgrade #10
 * =================================
 * Client-side ring buffer that captures the trail of events before an error.
 * When QueryGuard or ErrorLogger captures an error, the breadcrumbs are
 * attached to metadata.breadcrumbs — giving full context of what happened.
 *
 * Captures: navigation, clicks, fetch calls, console errors, state changes.
 * Max 30 entries (Sentry-style ring buffer).
 */

export interface Breadcrumb {
  type: "navigation" | "click" | "fetch" | "console" | "state" | "custom";
  category: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

const MAX_BREADCRUMBS = 30;
const breadcrumbs: Breadcrumb[] = [];

function addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp">) {
  breadcrumbs.push({ ...crumb, timestamp: Date.now() });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

/**
 * Get a snapshot of current breadcrumbs (oldest → newest).
 * Returns a copy so the caller can't mutate the buffer.
 */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

/**
 * Add a custom breadcrumb from application code.
 */
export function addCustomBreadcrumb(category: string, message: string, data?: Record<string, unknown>) {
  addBreadcrumb({ type: "custom", category, message, data });
}

/**
 * Initialize all automatic breadcrumb collectors.
 * Call this once on app mount (client-side only).
 */
export function initBreadcrumbTracker() {
  if (typeof window === "undefined") return;

  // ── Navigation breadcrumbs ──
  // Track pushState (Next.js client-side navigation)
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    const from = window.location.pathname;
    const result = origPushState.apply(this, args);
    const to = window.location.pathname;
    if (from !== to) {
      addBreadcrumb({
        type: "navigation",
        category: "navigation",
        message: `${from} → ${to}`,
        data: { from, to },
      });
    }
    return result;
  };

  // Track popstate (browser back/forward)
  window.addEventListener("popstate", () => {
    addBreadcrumb({
      type: "navigation",
      category: "navigation.back",
      message: `Back/forward → ${window.location.pathname}`,
      data: { to: window.location.pathname },
    });
  });

  // ── Click breadcrumbs ──
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    const tag = target.tagName?.toLowerCase() || "unknown";
    const text = target.textContent?.trim().slice(0, 50) || "";
    const ariaLabel = target.getAttribute("aria-label") || "";
    const id = target.id ? `#${target.id}` : "";
    const classes = target.className && typeof target.className === "string"
      ? `.${target.className.split(" ").slice(0, 2).join(".")}`
      : "";

    // Only track meaningful clicks (buttons, links, inputs)
    if (["button", "a", "input", "select", "textarea", "label"].includes(tag) || target.role === "button") {
      addBreadcrumb({
        type: "click",
        category: "ui.click",
        message: `${tag}${id}${classes} "${text || ariaLabel}"`.slice(0, 120),
        data: {
          tag,
          id: target.id || undefined,
          text: text.slice(0, 30) || undefined,
          ariaLabel: ariaLabel || undefined,
        },
      });
    }
  }, { capture: true, passive: true });

  // ── Fetch breadcrumbs ──
  const origFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = init?.method || "GET";

    // Only track Supabase and API calls (not assets/chunks)
    if (url.includes("/rest/v1/") || url.includes("/functions/v1/") || url.includes("/api/")) {
      // Extract short path
      const shortUrl = url.replace(/https?:\/\/[^/]+/, "").split("?")[0];
      addBreadcrumb({
        type: "fetch",
        category: "fetch",
        message: `${method} ${shortUrl}`,
        data: { method, url: shortUrl },
      });
    }

    return origFetch.call(this, input, init);
  };

  // ── Console error breadcrumbs ──
  const origError = console.error;
  console.error = function (...args: unknown[]) {
    const message = args.map(a => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.message;
      try { return JSON.stringify(a).slice(0, 100); } catch { return String(a); }
    }).join(" ").slice(0, 150);

    addBreadcrumb({
      type: "console",
      category: "console.error",
      message,
    });

    return origError.apply(console, args);
  };

  // Add initial breadcrumb
  addBreadcrumb({
    type: "navigation",
    category: "navigation.init",
    message: `Page loaded: ${window.location.pathname}`,
    data: { url: window.location.pathname, referrer: document.referrer || undefined },
  });
}
