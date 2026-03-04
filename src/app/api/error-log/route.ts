import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── Helpers ──────────────────────────────────────────────────
function generateFingerprint(errorMessage: string, componentName: string | null, pageUrl: string | null): string {
  const normalized = (errorMessage || "")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/[a-z0-9-]{20,}/gi, "/:slug")
    .slice(0, 200);
  const component = (componentName || "unknown").slice(0, 50);
  const page = (pageUrl || "").replace(/https?:\/\/[^/]+/, "").split("?")[0].slice(0, 100);
  const raw = `${normalized}|${component}|${page}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `qg_${Math.abs(hash).toString(36)}`;
}

const PAGE_CRITICALITY: Record<string, number> = {
  "/dashboard": 10, "/dashboard/learn": 9, "/dashboard/courses": 8,
  "/dashboard/jax": 7, "/dashboard/channels": 6, "/admin": 3, "/enterprise": 5,
};

function calculateImpactScore(pageUrl: string | null, severity: string): number {
  const path = (pageUrl || "").replace(/https?:\/\/[^/]+/, "").split("?")[0];
  let criticality = 1;
  for (const [prefix, score] of Object.entries(PAGE_CRITICALITY)) {
    if (path.startsWith(prefix)) { criticality = score; break; }
  }
  const sevMult = severity === "fatal" ? 3 : severity === "error" ? 2 : severity === "warn" ? 1 : 0.5;
  return Math.round(criticality * sevMult * 10) / 10;
}

// ── Webhook firing (Upgrade #14) ────────────────────────────
async function fireWebhooks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  issueTitle: string,
  severity: string,
  isRegression: boolean,
  fingerprint: string
) {
  try {
    const { data: configs } = await supabase
      .from("queryguard_alert_config")
      .select("*")
      .eq("enabled", true);

    if (!configs || configs.length === 0) return;

    for (const config of configs) {
      // Check severity threshold
      const sevOrder = ["info", "warn", "error", "fatal"];
      if (sevOrder.indexOf(severity) < sevOrder.indexOf(config.min_severity || "error")) continue;

      // Check throttle
      if (config.last_fired_at) {
        const msSinceLast = Date.now() - new Date(config.last_fired_at).getTime();
        if (msSinceLast < (config.throttle_minutes || 60) * 60 * 1000) continue;
      }

      if (config.alert_type === "webhook" && config.target_url) {
        const emoji = isRegression ? "🔄" : severity === "fatal" ? "🔴" : severity === "error" ? "🟠" : "🟡";
        const label = isRegression ? "REGRESSION" : "NEW ISSUE";
        // Slack-compatible payload
        fetch(config.target_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${emoji} *[QueryGuard] ${label}*\n${issueTitle}\nSeverity: ${severity}\nFingerprint: \`${fingerprint}\``,
            // Discord compatibility
            content: `${emoji} **[QueryGuard] ${label}**\n${issueTitle}\nSeverity: ${severity}\nFingerprint: \`${fingerprint}\``,
          }),
        }).catch(() => {});

        // Update last_fired_at
        supabase
          .from("queryguard_alert_config")
          .update({ last_fired_at: new Date().toISOString() })
          .eq("id", config.id)
          .then(() => {});
      }

      if (config.alert_type === "system_alert") {
        // Broadcast via Supabase Realtime
        supabase.channel("system-alerts").send({
          type: "broadcast",
          event: "queryguard_alert",
          payload: { title: issueTitle, severity, fingerprint, isRegression },
        }).catch(() => {});
      }
    }
  } catch {}
}

// ── Error Budget (Upgrade #16) ──────────────────────────────
async function updateErrorBudget(supabase: Awaited<ReturnType<typeof createClient>>, errorType: string) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("queryguard_error_budget")
      .select("*")
      .eq("date", today)
      .single();

    if (existing) {
      await supabase
        .from("queryguard_error_budget")
        .update({
          error_count: (existing.error_count || 0) + 1,
          query_failure_count: errorType.includes("query") || errorType.includes("rpc")
            ? (existing.query_failure_count || 0) + 1
            : existing.query_failure_count || 0,
          burn_rate: ((existing.error_count || 0) + 1) / (existing.budget_limit || 50),
        })
        .eq("date", today);
    } else {
      await supabase
        .from("queryguard_error_budget")
        .insert({
          date: today,
          error_count: 1,
          query_failure_count: errorType.includes("query") || errorType.includes("rpc") ? 1 : 0,
          burn_rate: 1 / 50,
        });
    }
  } catch {}
}

/**
 * POST /api/error-log
 * QueryGuard v2: Logs errors with fingerprinting, issue grouping,
 * regression detection, impact scoring, webhooks, and error budget.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      error_message, error_stack, component_name, page_url,
      metadata, severity: rawSeverity,
      fingerprint: clientFingerprint, impact_score: clientImpact,
      deploy_version, session_id, error_type, duration_ms,
    } = body;

    if (!error_message) {
      return NextResponse.json({ error: "error_message required" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const severity = rawSeverity || "error";

    // Generate fingerprint (client may have already provided one)
    const fingerprint = clientFingerprint || generateFingerprint(error_message, component_name, page_url);
    const impactScore = clientImpact || calculateImpactScore(page_url, severity);

    // Insert the raw log entry
    await supabase.from("client_error_log").insert({
      user_id: user?.id || null,
      error_message: String(error_message).slice(0, 2000),
      error_stack: error_stack ? String(error_stack).slice(0, 5000) : null,
      component_name: component_name || null,
      page_url: page_url || null,
      user_agent: request.headers.get("user-agent") || null,
      metadata: metadata || {},
      severity,
      fingerprint,
      impact_score: impactScore,
      deploy_version: deploy_version || null,
      session_id: session_id || null,
      error_type: error_type || "client_error",
      duration_ms: duration_ms || null,
    });

    // ── Upgrade #8 + #11: Issue grouping + regression detection ──
    // Skip canary entries from issue tracking
    if (error_type !== "canary") {
      const { data: existingIssue } = await supabase
        .from("error_issues")
        .select("*")
        .eq("fingerprint", fingerprint)
        .single();

      let isRegression = false;

      if (existingIssue) {
        // Issue exists — increment count + update last_seen
        const wasResolved = ["resolved", "auto_resolved", "ignored"].includes(existingIssue.status);
        isRegression = wasResolved;

        // Count distinct users for this fingerprint
        const { count: userCount } = await supabase
          .from("client_error_log")
          .select("user_id", { count: "exact", head: true })
          .eq("fingerprint", fingerprint)
          .not("user_id", "is", null);

        await supabase
          .from("error_issues")
          .update({
            status: wasResolved ? "regressed" : existingIssue.status,
            severity: wasResolved && severity === "error" ? "error" : existingIssue.severity,
            occurrence_count: (existingIssue.occurrence_count || 1) + 1,
            affected_users: userCount || existingIssue.affected_users,
            last_seen: new Date().toISOString(),
            last_page_url: page_url || existingIssue.last_page_url,
            last_metadata: metadata || existingIssue.last_metadata,
            impact_score: Math.max(impactScore, existingIssue.impact_score || 0),
            resolved_at: wasResolved ? null : existingIssue.resolved_at,
          })
          .eq("id", existingIssue.id);
      } else {
        // New issue — create it
        await supabase.from("error_issues").insert({
          fingerprint,
          title: String(error_message).slice(0, 500),
          error_type: error_type || "client_error",
          status: "open",
          severity,
          impact_score: impactScore,
          occurrence_count: 1,
          affected_users: user ? 1 : 0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          last_page_url: page_url || null,
          last_metadata: metadata || {},
        });
      }

      // ── Upgrade #14: Fire webhooks on new issues or regressions ──
      if (!existingIssue || isRegression) {
        fireWebhooks(supabase, String(error_message).slice(0, 200), severity, isRegression, fingerprint);
      }

      // ── Upgrade #16: Update error budget ──
      updateErrorBudget(supabase, error_type || "client_error");
    }

    return NextResponse.json({ logged: true, fingerprint });
  } catch {
    return NextResponse.json({ error: "Failed to log error" }, { status: 500 });
  }
}

/**
 * GET /api/error-log
 * Returns recent errors + issues + budget for admin debugging.
 * Supports: ?view=issues|logs|budget|spike|trend
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("auth_id", user.id)
      .single();

    if (!profile || !["super_admin", "org_admin", "manager"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const view = request.nextUrl.searchParams.get("view") || "logs";
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");
    const severity = request.nextUrl.searchParams.get("severity");
    const errorType = request.nextUrl.searchParams.get("error_type");
    const status = request.nextUrl.searchParams.get("status");

    // ── Issues view (Upgrade #20) ──
    if (view === "issues") {
      let query = supabase
        .from("error_issues")
        .select("*")
        .order("last_seen", { ascending: false })
        .order("impact_score", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);
      if (severity) query = query.eq("severity", severity);
      if (errorType) query = query.eq("error_type", errorType);

      const { data, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ issues: data || [], total: data?.length || 0 });
    }

    // ── Error Budget view (Upgrade #16) ──
    if (view === "budget") {
      const { data } = await supabase
        .from("queryguard_error_budget")
        .select("*")
        .order("date", { ascending: false })
        .limit(30);
      return NextResponse.json({ budget: data || [] });
    }

    // ── Spike detection (Upgrade #15) ──
    if (view === "spike") {
      const { data } = await supabase.rpc("queryguard_check_spike");
      return NextResponse.json({ spike: data || {} });
    }

    // ── Trend data (Upgrade #19) — hourly counts for last 7 days ──
    if (view === "trend") {
      const { data } = await supabase
        .from("client_error_log")
        .select("created_at, severity, error_type")
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("created_at", { ascending: true });

      // Bucket into hourly counts
      const buckets: Record<string, { total: number; fatal: number; error: number; warn: number; query: number }> = {};
      for (const row of data || []) {
        const hour = new Date(row.created_at).toISOString().slice(0, 13) + ":00:00Z";
        if (!buckets[hour]) buckets[hour] = { total: 0, fatal: 0, error: 0, warn: 0, query: 0 };
        buckets[hour].total++;
        if (row.severity === "fatal") buckets[hour].fatal++;
        if (row.severity === "error") buckets[hour].error++;
        if (row.severity === "warn") buckets[hour].warn++;
        if (row.error_type === "silent_query_failure" || row.error_type === "rpc_failure") buckets[hour].query++;
      }

      const trend = Object.entries(buckets)
        .map(([hour, counts]) => ({ hour, ...counts }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return NextResponse.json({ trend });
    }

    // ── Schema drift check (Upgrade #6) ──
    if (view === "schema_drift") {
      const { data: manifest } = await supabase
        .from("queryguard_schema_manifest")
        .select("table_name, column_name, data_type, snapshot_at");
      return NextResponse.json({ manifest: manifest || [] });
    }

    // ── Default: raw logs view ──
    let query = supabase
      .from("client_error_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (severity) query = query.eq("severity", severity);
    if (errorType) query = query.eq("error_type", errorType);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ errors: data || [], total: data?.length || 0 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/error-log
 * Update issue status (resolve, ignore, reopen).
 * Also handles: cleanup, spike-check
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("auth_id", user.id)
      .single();

    if (!profile || !["super_admin", "org_admin", "manager"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { action, issue_id, status: newStatus } = body;

    // ── Update issue status ──
    if (action === "update_status" && issue_id && newStatus) {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === "resolved") updateData.resolved_at = new Date().toISOString();
      if (newStatus === "open") updateData.resolved_at = null;

      const { error } = await supabase
        .from("error_issues")
        .update(updateData)
        .eq("id", issue_id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ updated: true });
    }

    // ── Cleanup old errors (Upgrade #24) ──
    if (action === "cleanup") {
      const { data } = await supabase.rpc("queryguard_cleanup_old_errors");
      return NextResponse.json({ cleaned: data });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
