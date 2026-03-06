/**
 * QueryGuard — Route & Entity Normalization
 *
 * Normalizes dynamic path segments so events group correctly.
 * /users/abc-123-def  →  /users/:id
 * /rest/v1/profiles   →  entity: "profiles"
 */

// ─── Route Normalization ──────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_RE = /\/\d{4,}(\/|$)/g;
const SHORT_HEX_RE = /\/[0-9a-f]{8,}(\/|$)/gi;
const LONG_SLUG_RE = /\/[a-zA-Z0-9_-]{32,}(\/|$)/g;

/**
 * Normalize a URL path by replacing dynamic segments with placeholders.
 *
 * Examples:
 *   /users/550e8400-e29b-41d4-a716-446655440000  →  /users/:id
 *   /dashboard/learn/lesson-abc123def456        →  /dashboard/learn/:slug
 *   /api/orders/98765                           →  /api/orders/:id
 */
export function normalizeRoute(path: string): string {
  if (!path) return "/";

  // Strip query string and hash
  let normalized = path.split("?")[0].split("#")[0];

  // Strip trailing slash (except root)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Replace UUIDs
  normalized = normalized.replace(UUID_RE, ":id");

  // Replace long hex strings (short hash IDs)
  normalized = normalized.replace(SHORT_HEX_RE, (_, suffix) => `/:id${suffix ?? ""}`);

  // Replace long slugs (32+ chars)
  normalized = normalized.replace(LONG_SLUG_RE, (_, suffix) => `/:slug${suffix ?? ""}`);

  // Replace numeric IDs (4+ digits)
  normalized = normalized.replace(NUMERIC_ID_RE, (_, suffix) => `/:id${suffix ?? ""}`);

  return normalized || "/";
}

// ─── Supabase Entity Extraction ───────────────────────────────────────────────

/**
 * Extract the Supabase table/entity name from a PostgREST URL.
 *
 * Examples:
 *   https://proj.supabase.co/rest/v1/user_profiles?select=*  →  "user_profiles"
 *   https://proj.supabase.co/rest/v1/rpc/get_streak_status   →  "rpc:get_streak_status"
 *   https://proj.supabase.co/auth/v1/token                   →  "auth:token"
 *   https://proj.supabase.co/functions/v1/quiz-brain          →  "fn:quiz-brain"
 */
export function extractSupabaseEntity(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    // Edge Functions: /functions/v1/{name}
    const fnMatch = path.match(/\/functions\/v1\/([^/?]+)/);
    if (fnMatch) return `fn:${fnMatch[1]}`;

    // Auth: /auth/v1/{endpoint}
    const authMatch = path.match(/\/auth\/v1\/([^/?]+)/);
    if (authMatch) return `auth:${authMatch[1]}`;

    // Storage: /storage/v1/object/{bucket}
    const storageMatch = path.match(/\/storage\/v1\/object\/([^/?]+)/);
    if (storageMatch) return `storage:${storageMatch[1]}`;

    // RPC: /rest/v1/rpc/{fn}
    const rpcMatch = path.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (rpcMatch) return `rpc:${rpcMatch[1]}`;

    // PostgREST table: /rest/v1/{table}
    const tableMatch = path.match(/\/rest\/v1\/([^/?]+)/);
    if (tableMatch) return tableMatch[1];

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify which family of Supabase API a URL belongs to.
 */
export function classifySupabaseFamily(url: string): import("../types/index.js").SupabaseRequestFamily {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path.includes("/functions/v1/")) return "functions";
    if (path.includes("/auth/v1/")) return "auth";
    if (path.includes("/storage/v1/")) return "storage";
    if (path.includes("/realtime/")) return "realtime";
    if (path.includes("/rest/v1/rpc/")) return "rpc";
    if (path.includes("/rest/v1/")) return "postgrest";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Determine if a URL is a Supabase endpoint.
 */
export function isSupabaseUrl(url: string, supabaseUrl?: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (supabaseUrl) {
      const sbHost = new URL(supabaseUrl).hostname;
      return host === sbHost;
    }
    return host.endsWith(".supabase.co") || host.endsWith(".supabase.in");
  } catch {
    return false;
  }
}

// ─── HTTP Method Normalization ────────────────────────────────────────────────

export function normalizeMethod(method: string | undefined): string {
  return (method ?? "GET").toUpperCase();
}

// ─── Stack Trace Normalization ────────────────────────────────────────────────

/**
 * Trim a stack trace to the most relevant lines.
 * Strips node_modules frames and limits total length.
 */
export function normalizeStack(stack: string | undefined, maxLines = 10): string | undefined {
  if (!stack) return undefined;
  const lines = stack
    .split("\n")
    .filter((l) => !l.includes("node_modules/") && !l.includes("webpack-internal://"))
    .slice(0, maxLines);
  return lines.join("\n").slice(0, 2000);
}
