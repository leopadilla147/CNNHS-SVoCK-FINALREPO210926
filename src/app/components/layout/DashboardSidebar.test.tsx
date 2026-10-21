import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./DashboardSidebar";
import type { CommissionerRole } from "../../context/AppContext";

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: {
    id: "electoral-1",
    name: "Electoral Commissioner",
    role: "admin" as "admin" | "sslg_adviser",
    email: "electoral@cnnhs.edu",
    commissionerRole: "electoral_board" as CommissionerRole | undefined,
    mustChangePassword: false,
    profilePictureUrl: undefined as string | undefined,
  },
}));

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({
    currentUser: mockCurrentUser,
    candidates: [],
    electionPeriod: { officialListPosted: false },
    setCurrentUser: vi.fn(),
  }),
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

vi.mock("../notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

function renderSidebar() {
  render(
    <MemoryRouter>
      <DashboardSidebar />
    </MemoryRouter>,
  );
}

describe("DashboardSidebar", () => {
  beforeEach(() => {
    mockCurrentUser.commissionerRole = "electoral_board";
    mockCurrentUser.role = "admin";
    mockCurrentUser.profilePictureUrl = undefined;
  });

  it("shows Live Results for the Electoral Board", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /Live Results/i }).getAttribute("href")).toBe(
      "/admin/live-results",
    );
  });

  it("does not show Live Results for other commissioner roles", () => {
    mockCurrentUser.commissionerRole = "screening_validation";

    renderSidebar();

    expect(screen.queryByRole("link", { name: /Live Results/i })).toBeNull();
  });

  it("shows the staff photo instead of the initial when one is set", () => {
    mockCurrentUser.profilePictureUrl =
      "https://example.supabase.co/storage/v1/object/public/admin-pictures/admin_1_1000.jpg";

    renderSidebar();

    expect(document.querySelector('img[src*="admin-pictures"]')).toBeTruthy();
  });

  it("falls back to the initial when no photo is set", () => {
    renderSidebar();

    expect(document.querySelector('img[src*="admin-pictures"]')).toBeNull();
  });

  describe("System Logs tab visibility", () => {
    it("shows All System Logs to the Chief Commissioner", () => {
      mockCurrentUser.commissionerRole = "chief";

      renderSidebar();

      expect(
        screen.getByRole("link", { name: /All System Logs/i }).getAttribute("href"),
      ).toBe("/admin/logs");
    });

    it.each(["screening_validation", "electoral_board", "grievance"] as const)(
      "hides System Logs from the %s commissioner",
      (commissionerRole) => {
        mockCurrentUser.commissionerRole = commissionerRole;

        renderSidebar();

        expect(screen.queryByRole("link", { name: /System Logs/i })).toBeNull();
      },
    );

    it("shows System Logs to the SSLG Adviser", () => {
      mockCurrentUser.role = "sslg_adviser";
      mockCurrentUser.commissionerRole = undefined;

      renderSidebar();

      expect(
        screen.getByRole("link", { name: /^System Logs$/i }).getAttribute("href"),
      ).toBe("/admin/logs");
    });
  });
});
