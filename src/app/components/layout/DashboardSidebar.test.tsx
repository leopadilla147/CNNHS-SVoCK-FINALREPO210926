import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./DashboardSidebar";
import type { CommissionerRole } from "../../context/AppContext";

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: {
    id: "electoral-1",
    name: "Electoral Commissioner",
    role: "admin" as const,
    email: "electoral@cnnhs.edu",
    commissionerRole: "electoral_board" as CommissionerRole,
    mustChangePassword: false,
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
});
