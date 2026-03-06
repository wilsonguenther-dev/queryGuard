/**
 * QueryGuard — Batch Queue
 *
 * Accumulates events in memory and flushes them to the ingestion endpoint
 * in batches. Never blocks user interactions. Handles offline gracefully.
 */

import type { QueryGuardEvent } from "../types/index.js";
import { safeJsonStringify } from "../redaction/index.js";

export interface BatchQueueOptions {
  endpoint: string;
  apiKey?: string;
  flushIntervalMs?: number;   // default 2000
  maxBatchSize?: number;       // default 20
  maxQueueSize?: number;       // default 200 — prevents unbounded growth
  debug?: boolean;
  /** Called when a batch fails. Return true to retry. */
  onFlushError?: (err: unknown) => void;
}

export class BatchQueue {
  private queue: QueryGuardEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private isShuttingDown = false;
  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly debug: boolean;
  private readonly onFlushError?: (err: unknown) => void;

  constructor(opts: BatchQueueOptions) {
    this.endpoint = opts.endpoint;
    this.apiKey = opts.apiKey;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.maxBatchSize = opts.maxBatchSize ?? 20;
    this.maxQueueSize = opts.maxQueueSize ?? 200;
    this.debug = opts.debug ?? false;
    this.onFlushError = opts.onFlushError;
  }

  /** Start the periodic flush timer. Call once on init. */
  start(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    // Flush on page unload using sendBeacon (browser only)
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", this.handleVisibilityChange);
      window.addEventListener("beforeunload", this.handleBeforeUnload);
    }
  }

  /** Stop the flush timer and flush remaining events. */
  stop(): void {
    this.isShuttingDown = true;
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("visibilitychange", this.handleVisibilityChange);
      window.removeEventListener("beforeunload", this.handleBeforeUnload);
    }
    void this.flush();
  }

  /** Add an event to the queue. Drops oldest if queue is full. */
  enqueue(event: QueryGuardEvent): void {
    if (this.isShuttingDown) return;

    // Circuit breaker — stop queueing if endpoint is consistently failing
    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      if (this.debug) {
        console.debug("[QueryGuard] Circuit breaker open — dropping event");
      }
      return;
    }

    // Prevent unbounded growth
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift(); // drop oldest
    }

    this.queue.push(event);

    if (this.debug) {
      console.debug(`[QueryGuard] Enqueued event (queue size: ${this.queue.length})`, event.category);
    }
  }

  /** Flush up to maxBatchSize events to the endpoint. */
  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      await this.send(batch);
      this.consecutiveFailures = 0;
      if (this.debug) {
        console.debug(`[QueryGuard] Flushed ${batch.length} events`);
      }
    } catch (err) {
      // Put events back at front of queue for retry
      this.queue.unshift(...batch);
      this.consecutiveFailures++;
      this.onFlushError?.(err);

      if (this.debug) {
        console.debug(`[QueryGuard] Flush failed (attempt ${this.consecutiveFailures})`, err);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async send(events: QueryGuardEvent[]): Promise<void> {
    const payload = { events, ...(this.apiKey ? { api_key: this.apiKey } : {}) };
    const body = safeJsonStringify(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body,
      // Don't let event logging block or time out long
      signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    });

    if (!res.ok) {
      throw new Error(`QueryGuard ingestion returned ${res.status}`);
    }
  }

  /**
   * sendBeacon fallback for page unload scenarios.
   * Data is delivered even after the page closes.
   */
  private beaconFlush(): void {
    if (this.queue.length === 0 || typeof navigator === "undefined") return;
    const batch = this.queue.splice(0, this.maxBatchSize);
    const payload = safeJsonStringify({ events: batch });
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(this.endpoint, blob);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.beaconFlush();
    }
  };

  private handleBeforeUnload = (): void => {
    this.beaconFlush();
  };

  /** Current queue depth — useful for debugging */
  get size(): number {
    return this.queue.length;
  }
}
