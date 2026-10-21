import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalAuditRole, auditRoleLabel } from "../auditRoles";
import { insertAuditLog } from "../supabaseData";

// insertAuditLog only fires when the module-level client exists — stub it
// so the RPC call can be asserted without a configured Supabase.
const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock("../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: mockRpc },
}));

describe("canonicalAuditRole", () => {
  it("keeps values already on the 027 constraint set", () => {
    expect(canonicalAuditRole("admin")).toBe("admin");
    expect(canonicalAuditRole("student")).toBe("student");
    expect(canonicalAuditRole("system")).toBe("system");
    expect(canonicalAuditRole("sslg_adviser")).toBe("sslg_adviser");
  });

  it("maps display strings onto the constraint set", () => {
    expect(canonicalAuditRole("Admin")).toBe("admin");
    expect(canonicalAuditRole("Administrator")).toBe("admin");
    expect(canonicalAuditRole("Student")).toBe("student");
    expect(canonicalAuditRole("SSLG Adviser")).toBe("sslg_adviser");
  });

  it("normalizes spacing and casing", () => {
    expect(canonicalAuditRole("  SSLG   Adviser ")).toBe("sslg_adviser");
    expect(canonicalAuditRole("SSLG-ADVISER")).toBe("sslg_adviser");
  });

  it("falls back to the constraint-valid system for unknown roles", () => {
    expect(canonicalAuditRole("Officer")).toBe("system");
    expect(canonicalAuditRole("")).toBe("system");
    expect(canonicalAuditRole(null)).toBe("system");
    expect(canonicalAuditRole(undefined)).toBe("system");
  });
});

describe("auditRoleLabel", () => {
  it("pretty-prints every canonical role", () => {
    expect(auditRoleLabel("admin")).toBe("Admin");
    expect(auditRoleLabel("Administrator")).toBe("Admin");
    expect(auditRoleLabel("student")).toBe("Student");
    expect(auditRoleLabel("sslg_adviser")).toBe("SSLG Adviser");
    expect(auditRoleLabel("SSLG Adviser")).toBe("SSLG Adviser");
    expect(auditRoleLabel("system")).toBe("System");
    expect(auditRoleLabel("Officer")).toBe("System");
  });
});

describe("insertAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
  });

  it.each([
    ["SSLG Adviser", "sslg_adviser"],
    ["Administrator", "admin"],
    ["Admin", "admin"],
    ["Student", "student"],
    ["system", "system"],
    // Unknown → constraint-valid fallback instead of a rejected insert.
    ["Officer", "system"],
  ])("sends %p as the constraint-valid role %p", async (role, expected) => {
    await insertAuditLog({ user: "Maria Santos", role, action: "Password Changed", details: "x", type: "success" });

    expect(mockRpc).toHaveBeenCalledWith(
      "insert_audit_log_rpc",
      expect.objectContaining({ p_actor_role: expected }),
    );
  });

  it("never lets a rejected write surface to the caller (best-effort)", async () => {
    mockRpc.mockRejectedValue(new Error("check constraint violated"));

    await expect(
      insertAuditLog({ user: "X", role: "Admin", action: "A", details: "D", type: "info" }),
    ).resolves.toBeUndefined();
  });
});
