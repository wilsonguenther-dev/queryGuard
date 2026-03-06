/**
 * QueryGuard — Server-Side Error Capture
 *
 * Helpers for capturing errors in Next.js API routes, server actions,
 * and any server-side Node.js context.
 *
 * Unlike the browser client, server-side capture sends events directly
 * (no batching interval) since requests have finite lifetimes.
 */

import type { CaptureOptions } from "../core/capture.js";
import { captureException, captureMessage } from "../core/capture.js";
import { flushQueryGuard } from "../core/init.js";

export type { CaptureOptions };

/**
 * Wrap a Next.js API route handler with error capture.
 *
 * @example
 * ```ts
 * import { withErrorCapture } from "queryguard/server";
 * import { NextRequest, NextResponse } from "next/server";
 *
 * export const GET = withErrorCapture(async (req: NextRequest) => {
 *   const data = await getData();
 *   return NextResponse.json(data);
 * });
 * ```
 */
export function withErrorCapture<
  TArgs extends unknown[],
  TReturn,
>(
  handler: (...args: TArgs) => Promise<TReturn>,
  opts: Omit<CaptureOptions, "category"> = {}
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    try {
      return await handler(...args);
    } catch (err) {
      captureException(err, {
        category: "server_error",
        severity: "error",
        ...opts,
      });
      // Flush immediately since the server response is ending
      await flushQueryGuard();
      throw err;
    }
  };
}

/**
 * Wrap a Next.js Server Action with error capture.
 * Same as withErrorCapture — just a named alias for clarity.
 */
export const withActionCapture = withErrorCapture;

/**
 * Create a server-side guarded fetch that instruments outgoing requests.
 * Use this on the server to track calls to external APIs if needed.
 *
 * Note: For Supabase traffic, use createGuardedFetch from queryguard/supabase instead.
 */
export function createServerGuardedFetch(): typeof fetch {
  return async function serverGuardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const start = Date.now();

    try {
      const response = await fetch(input, init);
      const durationMs = Date.now() - start;

      if (!response.ok && response.status >= 500) {
        captureMessage(`Server fetch ${method} ${url} → ${response.status}`, {
          category: "server_error",
          severity: "error",
          httpMethod: method,
          httpStatus: response.status,
          durationMs,
        });
      }

      return response;
    } catch (err) {
      const durationMs = Date.now() - start;
      captureException(err, {
        category: "network_error",
        severity: "error",
        httpMethod: method,
        durationMs,
      });
      throw err;
    }
  };
}

// Re-export the core capture functions so server code only needs one import
export { captureException, captureMessage };
