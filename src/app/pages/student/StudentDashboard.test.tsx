import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentDashboard from "./StudentDashboard";
import type { ElectionPeriod } from "../../context/AppContext";

// The dashboard only reads these through useApp, so the page is rendered
// against a flat context stub — no provider, no Supabase.
let electionPeriod: ElectionPeriod;

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock("../../lib/supabaseData", () => ({ reviewPartyCandidacyRpc: vi.fn() }));

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({
    candidates: [],
    setCandidates: vi.fn(),
    electionPeriod,
    currentUser: { id: "student-1", name: "Student" },
    students: [],
    notifications: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    addLog: vi.fn(),
  }),
}));

const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function period(overrides: Partial<ElectionPeriod> = {}): ElectionPeriod {
  return {
    startDate: "2026-11-02",
    startTime: "08:00",
    endDate: "2026-11-02",
    endTime: "17:00",
    isActive: false,
    ...overrides,
  };
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <StudentDashboard />
    </MemoryRouter>,
  );
}

describe("StudentDashboard fingerprint reminder", () => {
  beforeEach(() => {
    electionPeriod = period();
  });

  it("is absent until the Electoral Board schedules the window", () => {
    renderDashboard();

    expect(screen.queryByText(/Fingerprint Registration/)).toBeNull();
  });

  it("reminds every voter while the window is live", () => {
    electionPeriod = period({
      fingerprintRegistrationStartAt: at(-HOUR),
      fingerprintRegistrationEndAt: at(2 * HOUR),
    });
    renderDashboard();

    expect(screen.getByText("Fingerprint Registration is Open")).toBeInTheDocument();
    expect(screen.getByText(/Enrolment closes on/)).toBeInTheDocument();
    expect(screen.getByText(/attend the IoT biometric kiosk/)).toBeInTheDocument();
  });

  it("announces a window that is scheduled but not open yet", () => {
    electionPeriod = period({
      fingerprintRegistrationStartAt: at(HOUR),
      fingerprintRegistrationEndAt: at(3 * HOUR),
    });
    renderDashboard();

    expect(screen.getByText("Fingerprint Registration — Scheduled")).toBeInTheDocument();
    expect(screen.getByText(/It opens on/)).toBeInTheDocument();
  });

  it("disappears once the window has closed", () => {
    // Early close, voting opening and a plan reset all land endAt in the past.
    electionPeriod = period({
      fingerprintRegistrationStartAt: at(-3 * HOUR),
      fingerprintRegistrationEndAt: at(-HOUR),
    });
    renderDashboard();

    expect(screen.queryByText(/Fingerprint Registration/)).toBeNull();
  });
});
