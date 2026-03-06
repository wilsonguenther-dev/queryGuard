/**
 * QueryGuard — SDK Ingestion Endpoint
 * POST /api/ingest
 *
 * Accepts batch payloads from the QueryGuard SDK (IngestionPayload format).
 * This is the new endpoint for SDK-instrumented apps.
 * The legacy /api/error-log route remains for backward compatibility.
 *
 * Request body: IngestionPayload
 * {
 *   events: QueryGuardEvent[],
 *   api_key?: string  // future: for multi-project SaaS auth
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryGuardEvent, Severity, ErrorCategory } from "@/types/sdk";

// ─── In-flight dedup guard ────────────────────────────────────────────────────
// Keeps a small recent fingerprint set to prevent the same event flooding in
// during a burst (e.g. 100 browser tabs refreshing at once).
const RECENT_FINGERPRINTS = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000;

function isDuplicate(fingerprint: string): boolean {
  const now = Date.now();
  // Prune expired entries
  for (const [fp, ts] of RECENT_FINGERPRINTS.entries()) {
    if (now - ts > DEDUP_WINDOW_MS) RECENT_FINGERPRINTS.delete(fp);
  }
  if (RECENT_FINGERPRINTS.has(fingerprint)) return true;
  RECENT_FINGERPRINTS.set(fingerprint, now);
  return false;
}

// ─── Map SDK event to DB row ──────────────────────────────────────────────────

function eventToLogRow(event: QueryGuardEvent, userAgent: string | null) {
  return {
    error_message: event.message.slice(0, 2000),
    error_stack: event.stack?.slice(0, 5000) ?? null,
    component_name: event.entity ?? null,
    page_url: event.page_url ?? null,
    user_agent: userAgent,
    metadata: {
      ...(event.metadata ?? {}),
      normalized_route: event.normalized_route,
      supabase_family: event.supabase_family,
      trace_id: event.trace_id,
      span_id: event.span_id,
      breadcrumbs: event.breadcrumbs,
      user: event.user,
      sdk_version: event.sdk?.version,
    },
    severity: event.severity,
    fingerprint: event.fingerprint,
    impact_score: event.impact_score ?? 0,
    deploy_version: event.deploy_version ?? null,
    session_id: event.session_id ?? null,
    error_type: mapCategory(event.category),
    duration_ms: event.duration_ms ?? null,
  };
}

/** Map SDK ErrorCategory to existing DB error_type enum values */
function mapCategory(category: ErrorCategory): string {
  const MAP: Partial<Record<ErrorCategory, string>> = {
    silent_query_failure: "silent_query_failure",
    rls_forbidden: "silent_query_failure",
    slow_query: "slow_query",
    edge_function_error: "edge_function_failure",
    auth_failure: "auth_failure",
    empty_result_anomaly: "empty_result",
    rpc_failure: "rpc_failure",
    client_exception: "client_error",
    unhandled_rejection: "client_error",
    server_error: "server_error",
    network_error: "client_error",
    canary_failure: "canary",
    unknown: "client_error",
  };
  return MAP[category] ?? "client_error";
}

// ─── Issue upsert ─────────────────────────────────────────────────────────────

async function upsertIssue(
  supabase: ReturnType<typeof createAdminClient>,
  event: QueryGuardEvent
): Promise<{ isNew: boolean; isRegression: boolean }> {
  const { data: existing } = await supabase
    .from("error_issues")
    .select("id, status, occurrence_count, affected_users, impact_score")
    .eq("fingerprint", event.fingerprint)
    .single();

  if (existing) {
    const wasResolved = ["resolved", "auto_resolved", "ignored"].includes(existing.status);

    await supabase
      .from("error_issues")
      .update({
        status: wasResolved ? "regressed" : existing.status,
        occurrence_count: (existing.occurrence_count ?? 1) + 1,
        last_seen: event.timestamp,
        last_page_url: event.page_url ?? null,
        impact_score: Math.max(event.impact_score ?? 0, existing.impact_score ?? 0),
        resolved_at: wasResolved ? null : undefined,
        environment: event.environment,
      })
      .eq("id", existing.id);

    return { isNew: false, isRegression: wasResolved };
  } else {
    await supabase.from("error_issues").insert({
      fingerprint: event.fingerprint,
      title: event.message.slice(0, 500),
      error_type: mapCategory(event.category),
      status: "open",
      severity: event.severity,
      impact_score: event.impact_score ?? 0,
      occurrence_count: 1,
      affected_users: event.user?.id ? 1 : 0,
      first_seen: event.timestamp,
      last_seen: event.timestamp,
      last_page_url: event.page_url ?? null,
      environment: event.environment,
      last_metadata: event.metadata ?? {},
    });
    return { isNew: true, isRegression: false };
  }
}

// ─── Budget update ────────────────────────────────────────────────────────────

async function updateBudget(
  supabase: ReturnType<typeof createAdminClient>,
  category: ErrorCategory
) {
  const today = new Date().toISOString().split("T")[0];
  const isQuery =
    category === "silent_query_failure" ||
    category === "rls_forbidden" ||
    category === "rpc_failure";

  try {
    const { data } = await supabase
      .from("queryguard_error_budget")
      .select("*")
      .eq("date", today)
      .single();

    if (data) {
      await supabase
        .from("queryguard_error_budget")
        .update({
          error_count: (data.error_count ?? 0) + 1,
          query_failure_count: isQuery ? (data.query_failure_count ?? 0) + 1 : data.query_failure_count ?? 0,
          burn_rate: ((data.error_count ?? 0) + 1) / (data.budget_limit ?? 50),
        })
        .eq("date", today);
    } else {
      await supabase.from("queryguard_error_budget").insert({
        date: today,
        error_count: 1,
        query_failure_count: isQuery ? 1 : 0,
        burn_rate: 1 / 50,
      });
    }
  } catch {
    // Non-fatal — budget tracking must never block event ingestion
  }
}

// ─── Webhook fire ─────────────────────────────────────────────────────────────

async function fireWebhooks(
  supabase: ReturnType<typeof createAdminClient>,
  event: QueryGuardEvent,
  isRegression: boolean
) {
  try {
    const { data: configs } = await supabase
      .from("queryguard_alert_config")
      .select("*")
      .eq("enabled", true);

    if (!configs?.length) return;

    const sevOrder: Severity[] = ["info", "warn", "error", "fatal"];

    for (const config of configs) {
      if (sevOrder.indexOf(event.severity) < sevOrder.indexOf(config.min_severity ?? "error")) continue;
      if (config.last_fired_at) {
        const msSince = Date.now() - new Date(config.last_fired_at).getTime();
        if (msSince < (config.throttle_minutes ?? 60) * 60_000) continue;
      }

      if (config.alert_type === "webhook" && config.target_url) {
        const emoji = isRegression ? "🔄" : event.severity === "fatal" ? "🔴" : "🟠";
        const label = isRegression ? "REGRESSION" : "NEW ISSUE";
        fetch(config.target_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${emoji} *[QueryGuard] ${label}*\n${event.message.slice(0, 200)}\nSeverity: ${event.severity}\nCategory: ${event.category}\nFingerprint: \`${event.fingerprint}\``,
            content: `${emoji} **[QueryGuard] ${label}**\n${event.message.slice(0, 200)}\nSeverity: ${event.severity}\nCategory: ${event.category}\nFingerprint: \`${event.fingerprint}\``,
          }),
        }).catch(() => {});

        supabase
          .from("queryguard_alert_config")
          .update({ last_fired_at: new Date().toISOString() })
          .eq("id", config.id)
          .then(() => {});
      }
    }
  } catch {
    // Webhooks must never block ingestion
  }
}

// ─── POST /api/ingest ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !Array.isArray(body.events)) {
      return NextResponse.json({ error: "events array required" }, { status: 400 });
    }

    // Future: validate api_key for multi-project SaaS
    // const apiKey = body.api_key ?? req.headers.get("x-api-key");

    const events: QueryGuardEvent[] = body.events;
    if (events.length === 0) {
      return NextResponse.json({ ingested: 0 });
    }
    if (events.length > 100) {
      return NextResponse.json({ error: "max 100 events per batch" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const userAgent = req.headers.get("user-agent")?.slice(0, 200) ?? null;

    let ingested = 0;
    let deduplicated = 0;

    for (const event of events) {
      // Basic validation
      if (!event.fingerprint || !event.message || !event.category) continue;

      // Server-side dedup within the flush window
      if (isDuplicate(`${event.fingerprint}:${event.session_id ?? ""}`)) {
        deduplicated++;
        continue;
      }

      // Skip canary events — they confirm the guard is alive but don't need issue tracking
      const isCanary = event.category === "canary_failure";

      try {
        // 1. Insert raw log
        await supabase
          .from("client_error_log")
          .insert(eventToLogRow(event, userAgent));

        // 2. Upsert issue + check regression
        if (!isCanary) {
          const { isNew, isRegression } = await upsertIssue(supabase, event);

          // 3. Update error budget
          await updateBudget(supabase, event.category);

          // 4. Fire webhooks on new issues and regressions
          if (isNew || isRegression) {
            fireWebhooks(supabase, event, isRegression);
          }
        }

        ingested++;
      } catch (err) {
        // Per-event failure must not abort the rest of the batch
        console.error("[QueryGuard/ingest] Event failed:", err);
      }
    }

    return NextResponse.json({ ingested, deduplicated });
  } catch (err) {
    console.error("[QueryGuard/ingest] Batch failed:", err);
    return NextResponse.json({ error: "Ingestion failed" }, { status: 500 });
  }
}
