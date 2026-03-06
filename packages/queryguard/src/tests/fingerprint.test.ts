import { describe, it, expect } from "vitest";
import { createFingerprint, createFingerprintFromParts } from "../fingerprint/index.js";

describe("createFingerprint", () => {
  it("produces a qg_ prefixed string", () => {
    const fp = createFingerprint({
      category: "rls_forbidden",
      entity: "user_profiles",
      http_status: 403,
      route: "/dashboard",
      message: "new row violates row-level security policy",
    });
    expect(fp).toMatch(/^qg_[0-9a-f]{8}$/);
  });

  it("is deterministic — same inputs produce same fingerprint", () => {
    const opts = {
      category: "rls_forbidden",
      entity: "user_profiles",
      http_status: 403,
      route: "/dashboard",
      message: "new row violates row-level security policy",
    } as const;
    expect(createFingerprint(opts)).toBe(createFingerprint(opts));
  });

  it("groups events from different UUIDs routes to the same fingerprint", () => {
    const base = {
      category: "silent_query_failure" as const,
      entity: "orders",
      http_status: 500,
      message: "relation does not exist",
    };
    const fp1 = createFingerprint({ ...base, route: "/dashboard/users/550e8400-e29b-41d4-a716-446655440000" });
    const fp2 = createFingerprint({ ...base, route: "/dashboard/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
    expect(fp1).toBe(fp2);
  });

  it("produces different fingerprints for different categories", () => {
    const base = { entity: "profiles", http_status: 403, route: "/dashboard", message: "forbidden" };
    const fp1 = createFingerprint({ ...base, category: "rls_forbidden" });
    const fp2 = createFingerprint({ ...base, category: "auth_failure" });
    expect(fp1).not.toBe(fp2);
  });

  it("strips UUIDs from messages", () => {
    const fp1 = createFingerprint({
      category: "silent_query_failure",
      message: "Error for user 550e8400-e29b-41d4-a716-446655440000",
      route: "/api",
    });
    const fp2 = createFingerprint({
      category: "silent_query_failure",
      message: "Error for user a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      route: "/api",
    });
    expect(fp1).toBe(fp2);
  });

  it("createFingerprintFromParts works as a convenience wrapper", () => {
    const fp1 = createFingerprint({
      category: "rpc_failure",
      entity: "get_streak",
      http_status: 500,
      route: "/dashboard",
      message: "function not found",
    });
    const fp2 = createFingerprintFromParts("rpc_failure", "get_streak", 500, "/dashboard", "function not found");
    expect(fp1).toBe(fp2);
  });
});
