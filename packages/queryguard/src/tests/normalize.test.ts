import { describe, it, expect } from "vitest";
import {
  normalizeRoute,
  extractSupabaseEntity,
  classifySupabaseFamily,
  isSupabaseUrl,
  normalizeStack,
} from "../normalize/index.js";

describe("normalizeRoute", () => {
  it("strips UUID path segments", () => {
    expect(normalizeRoute("/users/550e8400-e29b-41d4-a716-446655440000")).toBe("/users/:id");
  });

  it("strips numeric IDs", () => {
    expect(normalizeRoute("/api/orders/98765/items")).toBe("/api/orders/:id/items");
  });

  it("strips long slugs", () => {
    expect(normalizeRoute("/lessons/this-is-a-very-long-lesson-slug-that-is-dynamic")).toBe("/lessons/:slug");
  });

  it("strips query strings", () => {
    expect(normalizeRoute("/dashboard?tab=issues&foo=bar")).toBe("/dashboard");
  });

  it("strips trailing slash", () => {
    expect(normalizeRoute("/dashboard/")).toBe("/dashboard");
  });

  it("preserves root /", () => {
    expect(normalizeRoute("/")).toBe("/");
  });

  it("handles empty string", () => {
    expect(normalizeRoute("")).toBe("/");
  });

  it("preserves short static paths unchanged", () => {
    expect(normalizeRoute("/dashboard/courses")).toBe("/dashboard/courses");
  });
});

describe("extractSupabaseEntity", () => {
  const base = "https://project.supabase.co";

  it("extracts table from PostgREST", () => {
    expect(extractSupabaseEntity(`${base}/rest/v1/user_profiles?select=*`)).toBe("user_profiles");
  });

  it("extracts function name from edge function", () => {
    expect(extractSupabaseEntity(`${base}/functions/v1/quiz-brain`)).toBe("fn:quiz-brain");
  });

  it("extracts rpc function name", () => {
    expect(extractSupabaseEntity(`${base}/rest/v1/rpc/get_streak_status`)).toBe("rpc:get_streak_status");
  });

  it("extracts auth endpoint", () => {
    expect(extractSupabaseEntity(`${base}/auth/v1/token`)).toBe("auth:token");
  });

  it("extracts storage bucket", () => {
    expect(extractSupabaseEntity(`${base}/storage/v1/object/avatars`)).toBe("storage:avatars");
  });

  it("returns undefined for non-Supabase URL", () => {
    expect(extractSupabaseEntity("https://example.com/foo")).toBeUndefined();
  });
});

describe("classifySupabaseFamily", () => {
  const base = "https://project.supabase.co";

  it("classifies postgrest", () => {
    expect(classifySupabaseFamily(`${base}/rest/v1/profiles`)).toBe("postgrest");
  });

  it("classifies rpc", () => {
    expect(classifySupabaseFamily(`${base}/rest/v1/rpc/fn`)).toBe("rpc");
  });

  it("classifies functions", () => {
    expect(classifySupabaseFamily(`${base}/functions/v1/edge-fn`)).toBe("functions");
  });

  it("classifies auth", () => {
    expect(classifySupabaseFamily(`${base}/auth/v1/token`)).toBe("auth");
  });

  it("classifies storage", () => {
    expect(classifySupabaseFamily(`${base}/storage/v1/object/bucket`)).toBe("storage");
  });

  it("returns unknown for unrecognized URL", () => {
    expect(classifySupabaseFamily("https://example.com/foo")).toBe("unknown");
  });
});

describe("isSupabaseUrl", () => {
  it("detects supabase.co URLs", () => {
    expect(isSupabaseUrl("https://abc123.supabase.co/rest/v1/profiles")).toBe(true);
  });

  it("matches against explicit supabaseUrl", () => {
    expect(isSupabaseUrl("https://myproject.supabase.co/rest/v1/profiles", "https://myproject.supabase.co")).toBe(true);
  });

  it("returns false for non-Supabase URL", () => {
    expect(isSupabaseUrl("https://example.com/api/data")).toBe(false);
  });
});

describe("normalizeStack", () => {
  it("strips node_modules frames", () => {
    const stack = `Error: test\n  at foo (app.ts:10)\n  at node_modules/react/index.js:1\n  at bar (app.ts:20)`;
    const result = normalizeStack(stack);
    expect(result).not.toContain("node_modules");
    expect(result).toContain("foo (app.ts:10)");
  });

  it("limits to maxLines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `  at fn${i} (file.ts:${i})`);
    const stack = `Error: test\n${lines.join("\n")}`;
    const result = normalizeStack(stack, 5);
    expect(result?.split("\n").length).toBeLessThanOrEqual(5);
  });

  it("returns undefined for undefined input", () => {
    expect(normalizeStack(undefined)).toBeUndefined();
  });
});
