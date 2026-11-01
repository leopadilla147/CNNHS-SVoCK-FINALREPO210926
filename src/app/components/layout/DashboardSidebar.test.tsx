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
    isCoCommissioner: false as boolean | undefined,
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
    mockCurrentUser.isCoCommissioner = false;
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

  describe("Election Calendar tab", () => {
    // Every role now carries the calendar tab (directly above the profile
    // tab); /admin/calendar is no longer bounced for the Adviser — see
    // DashboardLayout.
    it("shows Election Calendar to the SSLG Adviser", () => {
      mockCurrentUser.role = "sslg_adviser";
      mockCurrentUser.commissionerRole = undefined;

      renderSidebar();

      expect(
        screen.getByRole("link", { name: /Election Calendar/i }).getAttribute("href"),
      ).toBe("/admin/calendar");
    });
  });

  describe("archive tabs (092)", () => {
    it("shows the renamed Candidates Archived Document tab for the Screening & Validation commissioner", () => {
      mockCurrentUser.commissionerRole = "screening_validation";

      renderSidebar();

      expect(
        screen.getByRole("link", { name: /Candidates Archived Document/i }).getAttribute("href"),
      ).toBe("/admin/archive");
      // the old label is gone
      expect(screen.queryByRole("link", { name: /^Archived Documents$/i })).toBeNull();
    });

    it("does not show the archive tabs for the Electoral Board commissioner", () => {
      renderSidebar();

      expect(screen.queryByRole("link", { name: /Candidates Archived Document/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /Complaints Archive/i })).toBeNull();
    });

    it("shows only Complaints Archive for the Grievance commissioner", () => {
      mockCurrentUser.commissionerRole = "grievance";

      renderSidebar();

      expect(screen.queryByRole("link", { name: /Candidates Archived Document/i })).toBeNull();
      expect(
        screen.getByRole("link", { name: /Complaints Archive/i }).getAttribute("href"),
      ).toBe("/admin/complaints-archive");
    });
  });

  describe("co-commissioner title under the name", () => {
    // The uppercase portal label also carries the primary's title, so
    // assertions count occurrences: the header switches from the primary's
    // title (2 renderings) to the co title (1 rendering of each).
    it("titles a co-commissioner after their primary's board", () => {
      mockCurrentUser.isCoCommissioner = true;

      renderSidebar();

      expect(screen.getByText("Co-commissioner of Electoral Board")).toBeTruthy();
      expect(screen.getAllByText("Commissioner of Electoral Board")).toHaveLength(1);
    });

    it("keeps the primary's own title for a non-co commissioner", () => {
      renderSidebar();

      expect(screen.getAllByText("Commissioner of Electoral Board")).toHaveLength(2);
      expect(screen.queryByText("Co-commissioner of Electoral Board")).toBeNull();
    });

    it.each(["screening_validation", "grievance"] as const)(
      "titles a %s co-commissioner after that board",
      (commissionerRole) => {
        mockCurrentUser.commissionerRole = commissionerRole;
        mockCurrentUser.isCoCommissioner = true;

        renderSidebar();

        expect(
          screen.getByText(
            commissionerRole === "screening_validation"
              ? "Co-commissioner of Screening & Validation"
              : "Co-commissioner of Grievance",
          ),
        ).toBeTruthy();
      },
    );
  });
});
