import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChiefAppointments from "./ChiefAppointments";
import type { StaffRosterRow } from "../../lib/supabaseData";

const {
  mockListStaffRosterRpc,
  mockRemoveOfficerRpc,
  mockResetPassword,
  mockConfirm,
  mockAddLog,
  mockCurrentUser,
} = vi.hoisted(() => ({
  mockListStaffRosterRpc: vi.fn(),
  mockRemoveOfficerRpc: vi.fn(),
  mockResetPassword: vi.fn(),
  mockConfirm: vi.fn(),
  mockAddLog: vi.fn(),
  // The acting chief — the audit actor name comes from here (not a label).
  mockCurrentUser: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Generated Officer Name",
    email: "chief.commissioner@cnnhs.edu",
    role: "admin",
    commissionerRole: "chief",
    mustChangePassword: false,
  },
}));

vi.mock("../../lib/supabaseData", () => ({
  listStaffRosterRpc: mockListStaffRosterRpc,
  removeOfficerRpc: mockRemoveOfficerRpc,
  resetPassword: mockResetPassword,
  createCommissioner: vi.fn(),
  createSslgAdviser: vi.fn(),
}));

// The confirm dialog is a generic utility with its own behaviour; these tests
// are about the page's actions, so every confirm resolves true.
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => ({ addLog: mockAddLog, currentUser: mockCurrentUser }) };
});

const CHIEF_ID = "11111111-1111-4111-8111-111111111111";
const ELECTORAL_ID = "33333333-3333-4333-8333-333333333333";

function rosterRow(overrides: Partial<StaffRosterRow> = {}): StaffRosterRow {
  return {
    id: ELECTORAL_ID,
    full_name: "Maria Santos",
    email: "electoral.commissioner@cnnhs.edu",
    role_type: "commissioner",
    commissioner_role: "electoral_board",
    status: "active",
    appointed_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ChiefAppointments />
    </MemoryRouter>,
  );
}

/** The commissioners table is the first table on the page. */
function commissionersTable() {
  return screen.getAllByRole("table")[0];
}

describe("ChiefAppointments officer removal (068)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockRemoveOfficerRpc.mockResolvedValue(undefined);
    mockListStaffRosterRpc.mockResolvedValue([
      rosterRow({
        id: CHIEF_ID,
        full_name: "Jose Dela Cruz",
        email: "chief.commissioner@cnnhs.edu",
        role_type: "chief",
        commissioner_role: "chief",
      }),
      rosterRow(),
    ]);
  });

  it("offers Remove on commissioner rows but never on the chief row", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const table = commissionersTable();
    const rows = within(table).getAllByRole("row");
    // rows[0] is the header; [1] the chief, [2] the commissioner.
    expect(within(rows[2]).getByRole("button", { name: /Remove/i })).toBeTruthy();
    // The chief row renders no action buttons at all.
    expect(within(rows[1]).queryByRole("button", { name: /Remove/i })).toBeNull();
    expect(within(rows[1]).queryByRole("button", { name: /Reset password/i })).toBeNull();
  });

  it("removes the confirmed officer and reloads the roster", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const table = commissionersTable();
    const commissionerRow = within(table).getAllByRole("row")[2];
    await user.click(within(commissionerRow).getByRole("button", { name: /Remove/i }));

    await waitFor(() => expect(mockRemoveOfficerRpc).toHaveBeenCalledWith(ELECTORAL_ID));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Removed Officer" }),
    );
    // initial load + post-removal reload
    expect(mockListStaffRosterRpc).toHaveBeenCalledTimes(2);
  });

  it("does not call the RPC when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const table = commissionersTable();
    const commissionerRow = within(table).getAllByRole("row")[2];
    await user.click(within(commissionerRow).getByRole("button", { name: /Remove/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockRemoveOfficerRpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure in the error banner", async () => {
    const user = userEvent.setup();
    mockRemoveOfficerRpc.mockRejectedValue(new Error("Only the Chief Commissioner can remove officer accounts."));
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const table = commissionersTable();
    const commissionerRow = within(table).getAllByRole("row")[2];
    await user.click(within(commissionerRow).getByRole("button", { name: /Remove/i }));

    await waitFor(() =>
      expect(screen.getByText("Only the Chief Commissioner can remove officer accounts.")).toBeTruthy(),
    );
  });

  // 068 renamed every officer account: audit entries must carry the acting
  // chief's real name, not a hardcoded role label.
  it("writes audit entries under the acting chief's name, not a role label", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const table = commissionersTable();
    const commissionerRow = within(table).getAllByRole("row")[2];
    await user.click(within(commissionerRow).getByRole("button", { name: /Remove/i }));

    await waitFor(() =>
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "Removed Officer", user: "Generated Officer Name" }),
      ),
    );
  });
});
