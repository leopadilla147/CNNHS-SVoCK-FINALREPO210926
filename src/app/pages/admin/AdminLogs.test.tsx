import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminLogs from "./AdminLogs";
import type { LogEntry } from "../../context/AppContext";

// The page reads logs through useApp, so it renders against a flat
// context stub — no provider, no Supabase (same pattern as
// AdminProfile.test.tsx / DashboardSidebar.test.tsx).

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../context/AppContext", () => ({
  useApp: mockUseApp,
}));

// Rows deliberately mix the two role formats the app actually produces:
// DB rows (mapLog) are lowercase and constrained by 027, local optimistic
// addLog entries are display strings with inconsistent casing.
const LOGS: LogEntry[] = [
  { id: "l1", timestamp: "2026-10-19 08:00:00", user: "Maria Santos", role: "Admin", action: "AdminLocal", details: "local admin row", type: "success" },
  { id: "l2", timestamp: "2026-10-19 08:01:00", user: "Juan Cruz", role: "admin", action: "AdminDb", details: "db admin row", type: "info" },
  { id: "l3", timestamp: "2026-10-19 08:02:00", user: "Adviser One", role: "SSLG Adviser", action: "AdviserLocal", details: "local adviser row", type: "success" },
  { id: "l4", timestamp: "2026-10-19 08:03:00", user: "Adviser Two", role: "sslg_adviser", action: "AdviserDb", details: "db adviser row", type: "info" },
  { id: "l5", timestamp: "2026-10-19 08:04:00", user: "Student One", role: "student", action: "StudentDb", details: "db student row", type: "warning" },
  { id: "l6", timestamp: "2026-10-19 08:05:00", user: "System", role: "system", action: "SystemDb", details: "db system row", type: "error" },
  { id: "l7", timestamp: "2026-10-19 08:06:00", user: "Plain Admin", role: "Administrator", action: "AdministratorLocal", details: "administrator row", type: "info" },
];

function renderLogs() {
  mockUseApp.mockReturnValue({ logs: LOGS });
  return render(<AdminLogs />);
}

/** The search box is the only text input on the page. */
function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Search logs/) as HTMLInputElement;
}

function clickRoleFilter(name: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("AdminLogs search input", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts letters, numbers, and spaces", () => {
    renderLogs();

    fireEvent.change(searchInput(), { target: { value: "Juan Dela Cruz 2026" } });

    expect(searchInput().value).toBe("Juan Dela Cruz 2026");
  });

  it("strips every character that is not a letter, number, or space", () => {
    renderLogs();

    fireEvent.change(searchInput(), { target: { value: "Ju4n@Dela!<script>#123" } });

    expect(searchInput().value).toBe("Ju4nDelascript123");
  });

  it("still filters rows by the kept text", () => {
    renderLogs();

    fireEvent.change(searchInput(), { target: { value: "Maria Santos" } });

    expect(screen.getByText("AdminLocal")).toBeInTheDocument();
    expect(screen.queryByText("AdminDb")).toBeNull();
  });
});

describe("AdminLogs role filter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers All, Admin, Student, SSLG Adviser, and System — never Officer", () => {
    renderLogs();

    for (const name of ["All", "Admin", "Student", "SSLG Adviser", "System"]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThanOrEqual(1);
    }
    // 'Officer' was removed from audit_logs.actor_role by migration 027.
    expect(screen.queryByRole("button", { name: "Officer" })).toBeNull();
  });

  it("matches the Admin filter against both display and DB formats", () => {
    renderLogs();

    clickRoleFilter("Admin");

    expect(screen.getByText("AdminLocal")).toBeInTheDocument();
    expect(screen.getByText("AdminDb")).toBeInTheDocument();
    // "Administrator" canonicalizes onto admin too.
    expect(screen.getByText("AdministratorLocal")).toBeInTheDocument();
    expect(screen.queryByText("AdviserDb")).toBeNull();
    expect(screen.queryByText("StudentDb")).toBeNull();
  });

  it("matches the SSLG Adviser filter against both formats", () => {
    renderLogs();

    clickRoleFilter("SSLG Adviser");

    expect(screen.getByText("AdviserLocal")).toBeInTheDocument();
    expect(screen.getByText("AdviserDb")).toBeInTheDocument();
    expect(screen.queryByText("AdminLocal")).toBeNull();
    expect(screen.queryByText("AdminDb")).toBeNull();
  });

  it("matches the Student and System filters", () => {
    renderLogs();

    clickRoleFilter("Student");
    expect(screen.getByText("StudentDb")).toBeInTheDocument();
    expect(screen.queryByText("SystemDb")).toBeNull();

    clickRoleFilter("System");
    expect(screen.getByText("SystemDb")).toBeInTheDocument();
    expect(screen.queryByText("StudentDb")).toBeNull();
  });

  it("shows every row again on All", () => {
    renderLogs();

    clickRoleFilter("SSLG Adviser");
    // Two 'All' buttons exist (Type + Role) — take the last one.
    const allButtons = screen.getAllByRole("button", { name: "All" });
    fireEvent.click(allButtons[allButtons.length - 1]);

    expect(screen.getByText("AdminLocal")).toBeInTheDocument();
    expect(screen.getByText("AdviserDb")).toBeInTheDocument();
    expect(screen.getByText("StudentDb")).toBeInTheDocument();
  });
});

describe("AdminLogs role badge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pretty-prints a lowercase DB role instead of echoing it raw", () => {
    renderLogs();

    const row = screen.getByText("AdviserDb").closest("tr")!;
    expect(within(row).getByText("SSLG Adviser")).toBeInTheDocument();
    expect(within(row).queryByText("sslg_adviser")).toBeNull();
  });

  it("labels a local display-string row consistently", () => {
    renderLogs();

    const row = screen.getByText("AdminLocal").closest("tr")!;
    expect(within(row).getByText("Admin")).toBeInTheDocument();
  });
});
