import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChiefAppointments from "./ChiefAppointments";
import type { StaffRosterRow } from "../../lib/supabaseData";

const {
  mockListStaffRosterRpc,
  mockRemoveOfficerRpc,
  mockSetOfficerStatus,
  mockSetAppointmentCommissioner,
  mockCreateCoCommissioner,
  mockConfirm,
  mockAddLog,
  mockCurrentUser,
} = vi.hoisted(() => ({
  mockListStaffRosterRpc: vi.fn(),
  mockRemoveOfficerRpc: vi.fn(),
  mockSetOfficerStatus: vi.fn(),
  mockSetAppointmentCommissioner: vi.fn(),
  mockCreateCoCommissioner: vi.fn(),
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
  setOfficerStatus: mockSetOfficerStatus,
  setAppointmentCommissioner: mockSetAppointmentCommissioner,
  createCoCommissioner: mockCreateCoCommissioner,
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
const APPOINTMENT_ID = "44444444-4444-4444-8444-444444444444";
const CO_ID = "55555555-5555-4555-8555-555555555555";

function rosterRow(overrides: Partial<StaffRosterRow> = {}): StaffRosterRow {
  return {
    id: ELECTORAL_ID,
    full_name: "Maria Santos",
    email: "electoral.commissioner@cnnhs.edu",
    role_type: "commissioner",
    commissioner_role: "electoral_board",
    status: "active",
    appointed_at: "2026-01-02T00:00:00Z",
    co_commissioner_of: null,
    ...overrides,
  };
}

function baseRoster() {
  return [
    rosterRow({
      id: CHIEF_ID,
      full_name: "Jose Dela Cruz",
      email: "chief.commissioner@cnnhs.edu",
      role_type: "chief",
      commissioner_role: "chief",
    }),
    rosterRow(),
  ];
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

/** Find the roster row that displays the given officer name. */
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByText(name) !== null);
  if (!row) throw new Error(`Row for "${name}" not found`);
  return row;
}

/** The overlay of the currently open OfficerFormDialog. */
function formDialog(): HTMLElement {
  const heading = screen.getByRole("heading", { name: /Add Co-commissioner|Commissioner of Appointment/ });
  const overlay = heading.closest(".fixed");
  if (!overlay) throw new Error("Officer form dialog overlay not found");
  return overlay as HTMLElement;
}

describe("ChiefAppointments officer removal (068)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockRemoveOfficerRpc.mockResolvedValue(undefined);
    mockSetOfficerStatus.mockResolvedValue(undefined);
    mockListStaffRosterRpc.mockResolvedValue(baseRoster());
  });

  it("offers Remove on commissioner rows but never on the chief row", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    expect(within(rowFor("Maria Santos")).getByRole("button", { name: /Remove/i })).toBeTruthy();
    expect(within(rowFor("Jose Dela Cruz")).queryByRole("button", { name: /Remove/i })).toBeNull();
  });

  // 103: the per-row "Reset password" action was removed from this page.
  it("no longer offers a Reset password action anywhere", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    expect(screen.queryByRole("button", { name: /Reset password/i })).toBeNull();
  });

  it("removes the confirmed officer and reloads the roster", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Remove/i }));

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

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Remove/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockRemoveOfficerRpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure in the error banner", async () => {
    const user = userEvent.setup();
    mockRemoveOfficerRpc.mockRejectedValue(new Error("Only the Chief Commissioner can remove officer accounts."));
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Remove/i }));

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

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Remove/i }));

    await waitFor(() =>
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "Removed Officer", user: "Generated Officer Name" }),
      ),
    );
  });
});

describe("ChiefAppointments officer status (103)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockSetOfficerStatus.mockResolvedValue(undefined);
    mockListStaffRosterRpc.mockResolvedValue(baseRoster());
  });

  it("changes a commissioner's status through the row select", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const select = within(rowFor("Maria Santos")).getByRole("combobox");
    await user.selectOptions(select, "on_leave");

    await waitFor(() => expect(mockSetOfficerStatus).toHaveBeenCalledWith(ELECTORAL_ID, "on_leave"));
    // no confirmation needed for non-terminal statuses
    expect(mockConfirm).not.toHaveBeenCalled();
    // initial load + post-change reload
    expect(mockListStaffRosterRpc).toHaveBeenCalledTimes(2);
  });

  it("confirms before a terminal status and logs the change", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.selectOptions(within(rowFor("Maria Santos")).getByRole("combobox"), "resigned");

    await waitFor(() => expect(mockSetOfficerStatus).toHaveBeenCalledWith(ELECTORAL_ID, "resigned"));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Officer Status Changed", user: "Generated Officer Name" }),
    );
  });

  it("reverts without calling the RPC when a terminal status is dismissed", async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.selectOptions(within(rowFor("Maria Santos")).getByRole("combobox"), "retired");

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockSetOfficerStatus).not.toHaveBeenCalled();
  });
});

describe("ChiefAppointments per-commissioner co-commissioners (104)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockListStaffRosterRpc.mockResolvedValue(baseRoster());
  });

  it("renders a co-commissioner row nested directly beneath its primary", async () => {
    mockListStaffRosterRpc.mockResolvedValue([
      ...baseRoster(),
      rosterRow({
        id: CO_ID,
        full_name: "Co Row",
        email: "co@cnnhs.edu",
        role_type: "co_commissioner",
        co_commissioner_of: ELECTORAL_ID,
      }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    const rows = within(commissionersTable()).getAllByRole("row");
    const primaryIndex = rows.findIndex((r) => within(r).queryByText("Maria Santos") !== null);
    const coIndex = rows.findIndex((r) => within(r).queryByText("Co Row") !== null);
    expect(coIndex).toBe(primaryIndex + 1);
    expect(within(rows[coIndex]).getByText("Co-commissioner — Electoral Board")).toBeTruthy();
  });

  it("adds a co-commissioner from the primary's row and shows the default password modal", async () => {
    const user = userEvent.setup();
    mockCreateCoCommissioner.mockResolvedValue({
      name: "Ramon Cruz",
      email: "ramon.cruz@cnnhs.edu",
      password: "coelectoral123",
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Add Co-commissioner/i }));

    const overlay = formDialog();
    await user.type(within(overlay).getByPlaceholderText("First name"), "Ramon");
    await user.type(within(overlay).getByPlaceholderText("Last name"), "Cruz");
    await user.type(within(overlay).getByPlaceholderText("account@cnnhs.edu"), "ramon.cruz@cnnhs.edu");
    await user.click(within(overlay).getByRole("button", { name: /Add Co-commissioner/i }));

    await waitFor(() =>
      expect(mockCreateCoCommissioner).toHaveBeenCalledWith("Ramon Cruz", "ramon.cruz@cnnhs.edu", "electoral_board"),
    );
    // the role's default password is displayed exactly once
    await waitFor(() => expect(screen.getByText("Default Password")).toBeTruthy());
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Appointed Co-commissioner" }),
    );
  });

  it("surfaces the RPC's primary-first error in the error banner", async () => {
    const user = userEvent.setup();
    mockListStaffRosterRpc.mockResolvedValue([
      rosterRow({
        id: ELECTORAL_ID,
        full_name: "Maria Santos",
        email: "electoral.commissioner@cnnhs.edu",
        commissioner_role: "electoral_board",
        status: "resigned",
      }),
    ]);
    mockCreateCoCommissioner.mockRejectedValue(
      new Error("A Commissioner of electoral board must be appointed before a Co-commissioner can be added."),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    await user.click(within(rowFor("Maria Santos")).getByRole("button", { name: /Add Co-commissioner/i }));
    const overlay = formDialog();
    await user.type(within(overlay).getByPlaceholderText("First name"), "Ramon");
    await user.type(within(overlay).getByPlaceholderText("Last name"), "Cruz");
    await user.type(within(overlay).getByPlaceholderText("account@cnnhs.edu"), "ramon.cruz@cnnhs.edu");
    await user.click(within(overlay).getByRole("button", { name: /Add Co-commissioner/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/must be appointed before a Co-commissioner can be added/),
      ).toBeTruthy(),
    );
  });
});

describe("ChiefAppointments records-only Appointment Commissioner (104)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockRemoveOfficerRpc.mockResolvedValue(undefined);
    mockSetAppointmentCommissioner.mockResolvedValue(undefined);
    mockListStaffRosterRpc.mockResolvedValue([
      ...baseRoster(),
      rosterRow({
        id: APPOINTMENT_ID,
        full_name: "Grace Lopez",
        email: "appointment@cnnhs.edu",
        commissioner_role: "appointment",
      }),
    ]);
  });

  it("shows the appointment record among the commissioners with a No login badge", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Grace Lopez")).toBeTruthy());

    expect(screen.getByText("No login")).toBeTruthy();
    expect(within(rowFor("Grace Lopez")).getByText("Commissioner of Appointment")).toBeTruthy();
    // "Edit record" + "Add Co-commissioner" live on the appointment row itself
    expect(within(rowFor("Grace Lopez")).getByRole("button", { name: /Edit record/i })).toBeTruthy();
    expect(within(rowFor("Grace Lopez")).getByRole("button", { name: /Add Co-commissioner/i })).toBeTruthy();
  });

  it("designates the appointment commissioner from the vacant slot", async () => {
    const user = userEvent.setup();
    mockListStaffRosterRpc.mockResolvedValue(baseRoster());
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    // every unfilled slot shows the Vacant badge; only Appointment can be designated
    expect(screen.getAllByText("Vacant").length).toBeGreaterThanOrEqual(3);
    await user.click(screen.getByRole("button", { name: /Designate/i }));

    const overlay = formDialog();
    await user.type(within(overlay).getByPlaceholderText("First name"), "Ramon");
    await user.type(within(overlay).getByPlaceholderText("Last name"), "Cruz");
    await user.type(within(overlay).getByPlaceholderText("account@cnnhs.edu"), "ramon.cruz@cnnhs.edu");
    await user.click(within(overlay).getByRole("button", { name: /Designate/i }));

    await waitFor(() =>
      expect(mockSetAppointmentCommissioner).toHaveBeenCalledWith("Ramon Cruz", "ramon.cruz@cnnhs.edu"),
    );
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Designated Commissioner of Appointment" }),
    );
  });

  it("edits the existing designation record through the prefilled dialog", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Grace Lopez")).toBeTruthy());

    await user.click(within(rowFor("Grace Lopez")).getByRole("button", { name: /Edit record/i }));

    const overlay = formDialog();
    expect((within(overlay).getByPlaceholderText("First name") as HTMLInputElement).value).toBe("Grace");
    expect((within(overlay).getByPlaceholderText("Last name") as HTMLInputElement).value).toBe("Lopez");
    expect((within(overlay).getByPlaceholderText("account@cnnhs.edu") as HTMLInputElement).value).toBe(
      "appointment@cnnhs.edu",
    );

    await user.clear(within(overlay).getByPlaceholderText("First name"));
    await user.type(within(overlay).getByPlaceholderText("First name"), "Ramon");
    await user.click(within(overlay).getByRole("button", { name: /Update Record/i }));

    await waitFor(() =>
      expect(mockSetAppointmentCommissioner).toHaveBeenCalledWith("Ramon Lopez", "appointment@cnnhs.edu"),
    );
  });

  it("adds a records-only co-commissioner to the appointment record without a password modal", async () => {
    const user = userEvent.setup();
    mockCreateCoCommissioner.mockResolvedValue({
      name: "Co Record",
      email: "co.record@cnnhs.edu",
      password: null,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText("Grace Lopez")).toBeTruthy());

    await user.click(within(rowFor("Grace Lopez")).getByRole("button", { name: /Add Co-commissioner/i }));

    const overlay = formDialog();
    await user.type(within(overlay).getByPlaceholderText("First name"), "Co");
    await user.type(within(overlay).getByPlaceholderText("Last name"), "Record");
    await user.type(within(overlay).getByPlaceholderText("account@cnnhs.edu"), "co.record@cnnhs.edu");
    await user.click(within(overlay).getByRole("button", { name: /Add Co-commissioner/i }));

    await waitFor(() =>
      expect(mockCreateCoCommissioner).toHaveBeenCalledWith("Co Record", "co.record@cnnhs.edu", "appointment"),
    );
    // records-only: no credential modal ever appears
    await waitFor(() => expect(mockListStaffRosterRpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Default Password")).toBeNull();
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "Appointed Co-commissioner",
        details: expect.stringContaining("records only"),
      }),
    );
  });
});

describe("ChiefAppointments readiness banner (103)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockListStaffRosterRpc.mockResolvedValue(baseRoster());
  });

  it("lists every required role that has no active officer", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    expect(screen.getByText(/Required officers missing/i)).toBeTruthy();
    // Only the Electoral Board commissioner is active on this roster.
    // (Direct-text matcher: the missing-role list lives in a nested span.)
    expect(bannerMissingText()).toContain(
      "Commissioner of Screening & Validation, Commissioner of Grievance, Commissioner of Appointment, SSLG Adviser.",
    );
  });

  it("stays quiet once all five required roles are staffed", async () => {
    mockListStaffRosterRpc.mockResolvedValue([
      rosterRow({
        id: CHIEF_ID,
        full_name: "Jose Dela Cruz",
        email: "chief.commissioner@cnnhs.edu",
        role_type: "chief",
        commissioner_role: "chief",
      }),
      rosterRow(),
      rosterRow({
        id: "66666666-6666-4666-8666-666666666661",
        full_name: "Elena Reyes",
        email: "screening@cnnhs.edu",
        commissioner_role: "screening_validation",
      }),
      rosterRow({
        id: "66666666-6666-4666-8666-666666666662",
        full_name: "Paolo Mendoza",
        email: "grievance@cnnhs.edu",
        commissioner_role: "grievance",
      }),
      rosterRow({
        id: APPOINTMENT_ID,
        full_name: "Grace Lopez",
        email: "appointment@cnnhs.edu",
        commissioner_role: "appointment",
      }),
      rosterRow({ id: CO_ID, full_name: "Rosa Aquino", email: "adviser@cnnhs.edu", role_type: "sslg_adviser", commissioner_role: null }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Maria Santos")).toBeTruthy());

    expect(screen.queryByText(/Required officers missing/i)).toBeNull();
  });

  it("never flags a co-commissioner as filling a role", async () => {
    mockListStaffRosterRpc.mockResolvedValue([
      rosterRow({
        id: CHIEF_ID,
        full_name: "Jose Dela Cruz",
        email: "chief.commissioner@cnnhs.edu",
        role_type: "chief",
        commissioner_role: "chief",
      }),
      rosterRow({ id: CO_ID, role_type: "co_commissioner", full_name: "Co Row", email: "co@cnnhs.edu" }),
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText(/Required officers missing/i)).toBeTruthy());

    // Electoral Board is only covered by a co-commissioner — the banner
    // still lists every required role as missing (the appoint form's
    // role select also carries that text elsewhere on the page).
    expect(bannerMissingText()).toContain(
      "Commissioner of Screening & Validation, Commissioner of Electoral Board, Commissioner of Grievance, Commissioner of Appointment, SSLG Adviser.",
    );
  });
});

/** The readiness banner's "Currently missing: ..." sentence. */
function bannerMissingText(): string {
  const paragraph = screen
    .getAllByText((_, element) =>
      element?.tagName === "P" &&
      (element.textContent ?? "").startsWith("Every required role needs an active officer"),
    )
    .at(-1);
  return paragraph?.textContent ?? "";
}
