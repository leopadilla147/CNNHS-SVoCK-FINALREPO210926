import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCandidates from "./AdminCandidates";
import type { Candidate } from "../../context/AppContext";

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../lib/supabaseData", () => ({
  reviewCandidacyRpc: vi.fn(),
  insertAuditLog: vi.fn(),
}));

// The confirm dialog is a generic utility with its own tests; these are about
// the page's filter behaviour, so no action ever needs confirming.
vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), dialog: null }),
}));

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return { ...actual, useApp: () => mockUseApp() };
});

function candidate(status: Candidate["status"], id: string, name: string): Candidate {
  return {
    id,
    surname: name,
    givenName: "Test",
    gradeLevel: "12",
    position: "President",
    gender: "Male",
    dateOfBirth: "2010-05-01",
    age: 16,
    email: `${id}@cnnhs.edu`,
    mobileNumber: "09171234567",
    homeAddress: "Daet, Camarines Norte",
    documents: {
      applicationForm: true,
      introductoryProfile: true,
    },
    status,
    submittedAt: "2026-01-15",
    votes: 0,
    studentId: `student-${id}`,
  };
}

/** Reports the current URL so tests can assert on the deep-link param. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(url = "/admin/candidates") {
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <AdminCandidates />
      <LocationProbe />
    </MemoryRouter>,
  );
  // member rows live inside the collapsed party panel — open it
  return utils;
}

/** Expands the (single) party panel so member rows are rendered. */
async function expandParties(user: ReturnType<typeof userEvent.setup>) {
  for (const party of screen.getAllByRole("button", { name: /Independent/ })) {
    await user.click(party);
  }
}

/** The status filter chips are the buttons with capitalized labels. */
function chip(name: RegExp) {
  return screen.getByRole("button", { name });
}

function isActive(button: HTMLElement) {
  // active chips switch to white-on-maroon; inactive ones stay gray
  return button.className.includes("text-white");
}

describe("AdminCandidates status filter deep links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApp.mockReturnValue({
      currentUser: {
        id: "1",
        name: "Screening Commissioner",
        role: "admin",
        commissionerRole: "screening_validation",
      },
      candidates: [
        candidate("pending", "1", "Pending Applicant"),
        candidate("approved", "2", "Approved Applicant"),
      ],
      setCandidates: vi.fn(),
      electionPeriod: {},
      addLog: vi.fn(),
      insertNotification: vi.fn(),
      students: [],
    });
  });

  it("opens on All when there is no filter param", async () => {
    const user = userEvent.setup();
    renderPage();
    await expandParties(user);

    expect(isActive(chip(/^all$/i))).toBe(true);
    expect(isActive(chip(/^pending$/i))).toBe(false);
    expect(screen.getByText(/Pending Applicant/)).toBeTruthy();
    expect(screen.getByText(/Approved Applicant/)).toBeTruthy();
  });

  it("applies a ?filter=pending deep link on the first view", async () => {
    const user = userEvent.setup();
    renderPage("/admin/candidates?filter=pending");
    await expandParties(user);

    expect(isActive(chip(/^pending$/i))).toBe(true);
    expect(screen.getByText(/Pending Applicant/)).toBeTruthy();
    expect(screen.queryByText(/Approved Applicant/)).toBeNull();
  });

  it("strips the param from the URL so the tab reopens on All", () => {
    renderPage("/admin/candidates?filter=pending");

    // the deep link is consumed, not left behind for the next visit
    expect(screen.getByTestId("location").textContent).toBe("/admin/candidates");
  });

  it("falls back to All for an unsupported filter param", async () => {
    const user = userEvent.setup();
    // "rejected" is no longer a chip on this surface
    renderPage("/admin/candidates?filter=rejected");
    await expandParties(user);

    expect(isActive(chip(/^all$/i))).toBe(true);
    expect(screen.getByText(/Approved Applicant/)).toBeTruthy();
  });

  it("re-applies a deep link arriving while the page is already mounted", async () => {
    const user = userEvent.setup();
    renderPage("/admin/candidates?filter=approved");
    await expandParties(user);

    expect(isActive(chip(/^approved$/i))).toBe(true);
    expect(screen.getByText(/Approved Applicant/)).toBeTruthy();
    expect(screen.queryByText(/Pending Applicant/)).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("/admin/candidates");
  });
});
