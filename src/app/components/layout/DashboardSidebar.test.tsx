import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./DashboardSidebar";
import type { CommissionerRole } from "../../context/AppContext";

const { mockCurrentUser, mockElectionPeriod, mockConfirm, mockRpc, mockToastSuccess, mockToastError } =
  vi.hoisted(() => ({
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
    mockElectionPeriod: {
      officialListPosted: false,
      id: "period-1" as string | undefined,
      schoolYear: "2026-2027" as string | undefined,
    },
    mockConfirm: vi.fn(),
    mockRpc: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
  }));

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({
    currentUser: mockCurrentUser,
    candidates: [],
    electionPeriod: mockElectionPeriod,
    setCurrentUser: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { rpc: mockRpc, auth: { signOut: vi.fn() } },
  isSupabaseConfigured: true,
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
    mockElectionPeriod.id = "period-1";
    mockElectionPeriod.schoolYear = "2026-2027";
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(false);
    mockRpc.mockReset();
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
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

  describe("seed injection button (130)", () => {
    it("shows the Inject seed data button above Logout for the Electoral Board commissioner", () => {
      renderSidebar();

      const seedButton = screen.getByRole("button", { name: /Inject seed data/i });
      const logoutButton = screen.getByRole("button", { name: "Logout" });
      // Positioned above the Logout button in the footer.
      expect(
        seedButton.compareDocumentPosition(logoutButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it.each(["screening_validation", "grievance"] as const)(
      "hides the seed button from the %s commissioner",
      (commissionerRole) => {
        mockCurrentUser.commissionerRole = commissionerRole;

        renderSidebar();

        expect(screen.queryByRole("button", { name: /Inject seed data/i })).toBeNull();
      },
    );

    it("hides the seed button from the SSLG Adviser", () => {
      mockCurrentUser.role = "sslg_adviser";
      mockCurrentUser.commissionerRole = undefined;

      renderSidebar();

      expect(screen.queryByRole("button", { name: /Inject seed data/i })).toBeNull();
    });

    it("calls seed_extra_parties_rpc with the active period id on confirm", async () => {
      mockConfirm.mockResolvedValueOnce(true);
      mockRpc.mockResolvedValueOnce({ data: { new_parties: 3, new_candidates: 46 }, error: null });

      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /Inject seed data/i }));

      await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
      expect(mockRpc).toHaveBeenCalledWith("seed_extra_parties_rpc", {
        p_election_period_id: "period-1",
      });
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Seed data injected: 3 parties and 46 candidates added to the active election period.",
      );
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it("surfaces the Postgres guard error verbatim when the rpc fails", async () => {
      mockConfirm.mockResolvedValueOnce(true);
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "These students already have a candidacy in this period: 999900000021." },
      });

      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /Inject seed data/i }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      expect(mockToastError).toHaveBeenCalledWith(
        "These students already have a candidacy in this period: 999900000021.",
      );
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("does not call the rpc when the confirm is cancelled", async () => {
      mockConfirm.mockResolvedValue(false);

      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /Inject seed data/i }));

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("reports a missing active election period instead of calling the rpc", async () => {
      mockElectionPeriod.id = undefined;
      mockConfirm.mockResolvedValueOnce(true);

      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /Inject seed data/i }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalled());
      expect(mockToastError).toHaveBeenCalledWith(
        "No active election period found. Create an election period first.",
      );
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});
