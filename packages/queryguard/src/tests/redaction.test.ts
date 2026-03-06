import { describe, it, expect } from "vitest";
import {
  redactHeaders,
  redactBody,
  redactUrl,
  sanitizeMetadata,
  safeJsonStringify,
  DEFAULT_REDACTION_CONFIG,
} from "../redaction/index.js";

describe("redactHeaders", () => {
  it("redacts authorization header", () => {
    const result = redactHeaders({ authorization: "Bearer abc123", "content-type": "application/json" });
    expect(result.authorization).toBe("[REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });

  it("redacts cookie header", () => {
    const result = redactHeaders({ cookie: "session=xyz; auth=abc" });
    expect(result.cookie).toBe("[REDACTED]");
  });

  it("is case-insensitive", () => {
    const result = redactHeaders({ Authorization: "Bearer token123" });
    expect(result.Authorization).toBe("[REDACTED]");
  });

  it("redacts apikey header", () => {
    const result = redactHeaders({ apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." });
    expect(result.apikey).toBe("[REDACTED]");
  });

  it("preserves non-sensitive headers", () => {
    const result = redactHeaders({ "x-request-id": "abc-123", "content-type": "application/json" });
    expect(result["x-request-id"]).toBe("abc-123");
  });

  it("handles empty headers", () => {
    expect(redactHeaders({})).toEqual({});
  });

  it("handles undefined", () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
});

describe("redactBody", () => {
  it("returns undefined when maxBodySize is 0 (default)", () => {
    const result = redactBody({ email: "user@example.com", data: "test" });
    expect(result).toBeUndefined();
  });

  it("redacts password fields when body logging enabled", () => {
    const config = { ...DEFAULT_REDACTION_CONFIG, maxBodySize: 1000 };
    const result = redactBody({ username: "alice", password: "super_secret" }, config) as Record<string, unknown>;
    expect(result.username).toBe("alice");
    expect(result.password).toBe("[REDACTED]");
  });

  it("redacts access_token when body logging enabled", () => {
    const config = { ...DEFAULT_REDACTION_CONFIG, maxBodySize: 1000 };
    const result = redactBody({ access_token: "eyJ...", user_id: "123" }, config) as Record<string, unknown>;
    expect(result.access_token).toBe("[REDACTED]");
    expect(result.user_id).toBe("123");
  });

  it("returns undefined for non-object input", () => {
    const config = { ...DEFAULT_REDACTION_CONFIG, maxBodySize: 1000 };
    expect(redactBody("string value", config)).toBeUndefined();
    expect(redactBody(null, config)).toBeUndefined();
  });
});

describe("redactUrl", () => {
  it("strips query parameters", () => {
    expect(redactUrl("https://project.supabase.co/rest/v1/profiles?access_token=abc&select=*"))
      .toBe("https://project.supabase.co/rest/v1/profiles");
  });

  it("strips hash fragments", () => {
    expect(redactUrl("https://example.com/page?foo=bar#section"))
      .toBe("https://example.com/page");
  });

  it("preserves path", () => {
    expect(redactUrl("https://project.supabase.co/rest/v1/user_profiles"))
      .toBe("https://project.supabase.co/rest/v1/user_profiles");
  });

  it("handles undefined", () => {
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe("sanitizeMetadata", () => {
  it("truncates long string values", () => {
    const config = { ...DEFAULT_REDACTION_CONFIG, maxMetadataValueLength: 10 };
    const result = sanitizeMetadata({ key: "a".repeat(100) }, config);
    expect(result?.key).toHaveLength(11); // 10 + "…"
  });

  it("handles undefined input", () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });

  it("caps depth at 2 levels", () => {
    // depth 0: { a: ... }
    // depth 1: { b: ... }
    // depth 2: { c: ... }
    // depth 3: safeSerialize called with depth=3 > 2 → { _truncated: true }
    const result = sanitizeMetadata({
      a: { b: { c: { d: "deep" } } }
    });
    const a = result?.a as Record<string, unknown>;
    const b = a?.b as Record<string, unknown>;
    const c = b?.c as Record<string, unknown>;
    expect(c._truncated).toBe(true);
  });

  it("removes undefined values", () => {
    const result = sanitizeMetadata({ a: "hello", b: undefined });
    expect(result?.a).toBe("hello");
    expect("b" in (result ?? {})).toBe(false);
  });
});

describe("safeJsonStringify", () => {
  it("handles circular references without throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => safeJsonStringify(obj)).not.toThrow();
    expect(safeJsonStringify(obj)).toContain("[Circular]");
  });

  it("handles Error objects", () => {
    const result = safeJsonStringify(new Error("test error"));
    expect(result).toContain("test error");
  });

  it("handles functions", () => {
    const result = safeJsonStringify({ fn: () => {} });
    expect(result).toContain("[Function]");
  });

  it("handles normal objects", () => {
    const result = safeJsonStringify({ a: 1, b: "two" });
    expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
  });
});
