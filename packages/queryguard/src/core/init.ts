/**
 * QueryGuard — Core Initialization
 *
 * Call initQueryGuard() once at app startup.
 * All other SDK functions read from this singleton config.
 */

import type { QueryGuardConfig, SdkInfo } from "../types/index.js";
import { detectDeployVersion, isBrowser } from "../utils/index.js";
import { DEFAULT_REDACTION_CONFIG } from "../redaction/index.js";
import { BatchQueue } from "../transport/batch-queue.js";

export const SDK_VERSION = "0.1.0";

export const SDK_INFO: SdkInfo = {
  name: "queryguard",
  version: SDK_VERSION,
  runtime: isBrowser() ? "browser" : "server",
};

// ─── Internal Singleton ───────────────────────────────────────────────────────

let _config: Required<QueryGuardConfig> | null = null;
let _queue: BatchQueue | null = null;
let _initialized = false;

/** Read-only access to the active config */
export function getConfig(): Required<QueryGuardConfig> {
  if (!_config) {
    throw new Error(
      "[QueryGuard] Not initialized. Call initQueryGuard({ endpoint }) before using the SDK."
    );
  }
  return _config;
}

/** Access the batch queue (throws if not initialized) */
export function getQueue(): BatchQueue {
  if (!_queue) {
    throw new Error("[QueryGuard] Not initialized.");
  }
  return _queue;
}

/** True if initQueryGuard() has been called */
export function isInitialized(): boolean {
  return _initialized;
}

// ─── initQueryGuard ───────────────────────────────────────────────────────────

/**
 * Initialize QueryGuard. Call this once at app startup.
 *
 * @example
 * ```ts
 * initQueryGuard({
 *   endpoint: "https://your-queryguard.com/api/error-log",
 *   environment: "production",
 * });
 * ```
 */
export function initQueryGuard(config: QueryGuardConfig): void {
  if (_initialized) {
    if (config.debug) {
      console.debug("[QueryGuard] Already initialized — skipping.");
    }
    return;
  }

  if (!config.endpoint) {
    throw new Error("[QueryGuard] endpoint is required.");
  }

  _config = {
    endpoint: config.endpoint,
    apiKey: config.apiKey ?? undefined!,
    projectId: config.projectId ?? undefined!,
    environment: config.environment ?? (typeof process !== "undefined" ? (process.env.NODE_ENV ?? "production") : "production"),
    deployVersion: config.deployVersion ?? detectDeployVersion() ?? undefined!,
    maxBreadcrumbs: config.maxBreadcrumbs ?? 30,
    slowQueryThresholdMs: config.slowQueryThresholdMs ?? 3000,
    flushIntervalMs: config.flushIntervalMs ?? 2000,
    maxBatchSize: config.maxBatchSize ?? 20,
    debug: config.debug ?? false,
    redaction: { ...DEFAULT_REDACTION_CONFIG, ...config.redaction },
    disabled: config.disabled ?? false,
  } as Required<QueryGuardConfig>;

  if (_config.disabled) {
    _initialized = true;
    return;
  }

  _queue = new BatchQueue({
    endpoint: _config.endpoint,
    apiKey: _config.apiKey,
    flushIntervalMs: _config.flushIntervalMs,
    maxBatchSize: _config.maxBatchSize,
    debug: _config.debug,
  });

  // Only start the timer in browser — on server we flush immediately per event
  if (isBrowser()) {
    _queue.start();
  }

  _initialized = true;

  if (_config.debug) {
    console.debug("[QueryGuard] Initialized", {
      endpoint: _config.endpoint,
      environment: _config.environment,
      version: SDK_VERSION,
    });
  }
}

/** Flush all queued events immediately. Useful before process exit. */
export async function flushQueryGuard(): Promise<void> {
  if (_queue) {
    await _queue.flush();
  }
}

/** Tear down — stop timers, flush, reset. Useful for testing. */
export function resetQueryGuard(): void {
  _queue?.stop();
  _queue = null;
  _config = null;
  _initialized = false;
}
