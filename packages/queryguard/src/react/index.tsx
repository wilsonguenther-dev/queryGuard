/**
 * QueryGuard — React Integration
 *
 * QueryGuardErrorBoundary: catches render errors and reports them.
 * ErrorLogger: mounts global handlers as a side-effect component.
 * useQueryGuard: hook for manual capture inside components.
 *
 * Tree-shakeable — import only what you use.
 */

"use client"; // Next.js App Router directive — safe to include, ignored elsewhere

import React, { Component, type ReactNode, useEffect } from "react";
import { captureException } from "../core/capture.js";
import { setupGlobalClientErrorCapture } from "../client/index.js";
import { isInitialized } from "../core/init.js";

// ─── QueryGuardErrorBoundary ──────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI. Receives the error. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
  /** Extra metadata to attach to the captured event */
  metadata?: Record<string, unknown>;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that captures render errors into QueryGuard.
 *
 * @example
 * ```tsx
 * <QueryGuardErrorBoundary fallback={<p>Something went wrong.</p>}>
 *   <App />
 * </QueryGuardErrorBoundary>
 * ```
 */
export class QueryGuardErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureException(error, {
      category: "client_exception",
      severity: "error",
      metadata: {
        componentStack: info.componentStack?.slice(0, 500) ?? "",
        ...this.props.metadata,
      },
    });
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        return fallback(this.state.error);
      }
      return (
        fallback ?? (
          <div
            style={{
              padding: "1rem",
              border: "1px solid #ef4444",
              borderRadius: "0.5rem",
              color: "#ef4444",
              fontFamily: "monospace",
              fontSize: "0.875rem",
            }}
          >
            <strong>Something went wrong.</strong>
            <pre style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
              {this.state.error.message}
            </pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

// ─── ErrorLogger ──────────────────────────────────────────────────────────────

/**
 * Mount this component once in your root layout to activate global error capture.
 * It attaches window.onerror, unhandledrejection, and breadcrumb listeners.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { ErrorLogger } from "queryguard/react";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ErrorLogger />
 *         {children}
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ErrorLogger(): null {
  useEffect(() => {
    if (!isInitialized()) return;
    const cleanup = setupGlobalClientErrorCapture();
    return cleanup;
  }, []);

  return null;
}

// ─── useQueryGuard ────────────────────────────────────────────────────────────

import type { CaptureOptions } from "../core/capture.js";

/**
 * Hook for manual error/message capture inside React components.
 *
 * @example
 * ```tsx
 * const { captureError, captureMsg } = useQueryGuard();
 *
 * async function handleSubmit() {
 *   try {
 *     await saveData();
 *   } catch (err) {
 *     captureError(err, { entity: "orders" });
 *   }
 * }
 * ```
 */
export function useQueryGuard() {
  return {
    captureError: (err: unknown, opts?: CaptureOptions) =>
      captureException(err, opts),
    captureMsg: (msg: string, opts?: CaptureOptions) => {
      // Import lazily to avoid pulling in all capture logic eagerly
      const { captureMessage } = require("../core/capture.js") as typeof import("../core/capture.js");
      return captureMessage(msg, opts);
    },
  };
}
