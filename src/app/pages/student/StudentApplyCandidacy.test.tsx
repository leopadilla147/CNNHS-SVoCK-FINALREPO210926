import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentApplyCandidacy from "./StudentApplyCandidacy";
import { emptyElectionPeriod } from "../../context/AppContext";
import type { Candidate, ElectionPeriod } from "../../context/AppContext";

const PERIOD_ID = "7c2e5a90-1b3f-4d6e-9a8c-5f0d2b7e4c11";
const STUDENT_ID = "5a1f2b3c-4d5e-4f60-8a91-2b3c4d5e6f70";

const {
  mockSubmitCandidacyRpc,
  mockReapplyPartyCandidacyRpc,
  mockUploadCandidateImage,
  mockFetchCandidateGate,
  mockFetchEafSignatoriesRpc,
  mockConfirm,
} = vi.hoisted(() => ({
  mockSubmitCandidacyRpc: vi.fn(),
  mockReapplyPartyCandidacyRpc: vi.fn(),
  mockUploadCandidateImage: vi.fn(),
  mockFetchCandidateGate: vi.fn(),
  mockFetchEafSignatoriesRpc: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ isSupabaseConfigured: false, supabase: undefined }));

vi.mock("../../lib/supabaseData", () => ({
  submitCandidacyRpc: mockSubmitCandidacyRpc,
  reapplyPartyCandidacyRpc: mockReapplyPartyCandidacyRpc,
  uploadCandidateImage: mockUploadCandidateImage,
  fetchCandidateGate: mockFetchCandidateGate,
  fetchEafSignatoriesRpc: mockFetchEafSignatoriesRpc,
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

let electionPeriod: ElectionPeriod;
let candidates: Candidate[] = [];

vi.mock("../../context/AppContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AppContext")>("../../context/AppContext");
  return {
    ...actual,
    useApp: () => ({
      electionPeriod,
      candidates,
      setCandidates: vi.fn(),
      currentUser: { id: STUDENT_ID, name: "Juan Dela Cruz", role: "student", email: "juan@student.cnnhs.edu" },
      students: [
        {
          id: STUDENT_ID,
          firstName: "Juan",
          lastName: "Dela Cruz",
          middleName: "Reyes",
          gradeLevel: "Grade 10",
          gender: "Male",
          birthdate: "2011-05-14",
          email: "juan@student.cnnhs.edu",
        },
      ],
      addLog: vi.fn(),
      insertNotification: vi.fn(),
      parties: [],
    }),
  };
});

// The page pulls the PSGC province list on mount; keep the tests offline and
// deterministic — the page falls back to its bundled Region V list.
vi.stubGlobal(
  "fetch",
  vi.fn(() => Promise.reject(new Error("offline")))
);

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "c1a2b3c4-0000-4000-8000-000000000001",
    surname: "Dela Cruz",
    givenName: "Juan",
    gradeLevel: "Grade 10",
    position: "Grade 10 Representative",
    gender: "Male",
    dateOfBirth: "2011-05-14",
    age: 15,
    email: "juan@student.cnnhs.edu",
    mobileNumber: "09123456789",
    homeAddress: "Brgy. Binanuahan, Pili, Camarines Sur",
    documents: { applicationForm: true, introductoryProfile: false, eafFront: false, eafBack: false },
    status: "ongoingSubmission",
    submittedAt: "2026-10-20",
    votes: 0,
    studentId: STUDENT_ID,
    electionPeriodId: PERIOD_ID,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <StudentApplyCandidacy />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  electionPeriod = { ...emptyElectionPeriod, id: PERIOD_ID, lifecycleStage: "application", candidacyOpen: true };
  candidates = [];
});

describe("StudentApplyCandidacy — 109 stage lock", () => {
  it("keeps Revise and Resubmit available for a low-tier rejection while the Application Stage is current", () => {
    candidates = [
      candidate({
        status: "rejected",
        rejectionTier: "low",
        rejectionReason: "Blurry EAF photo",
      }),
    ];
    renderPage();

    expect(screen.getByText("Application Rejected")).toBeTruthy();
    expect(screen.getByText("Revise and Resubmit")).toBeTruthy();
  });

  it("replaces Revise and Resubmit with the ended notice once the Application Stage has ended", () => {
    candidates = [
      candidate({
        status: "rejected",
        rejectionTier: "low",
        rejectionReason: "Blurry EAF photo",
      }),
    ];
    electionPeriod = { ...electionPeriod, lifecycleStage: "campaign", candidacyOpen: false };
    renderPage();

    expect(screen.getByText("Application Rejected")).toBeTruthy();
    expect(screen.queryByText("Revise and Resubmit")).toBeNull();
    expect(
      screen.getByText(/can no longer be revised or resubmitted/i)
    ).toBeTruthy();
  });

  it("locks the EAF page for an in-flight application once the Application Stage has ended", () => {
    candidates = [candidate({ status: "ongoingSubmission" })];
    electionPeriod = { ...electionPeriod, lifecycleStage: "campaign", candidacyOpen: false };
    renderPage();

    expect(screen.getByText("The Candidacy Application Stage has ended")).toBeTruthy();
    expect(screen.getByText(/can no longer be submitted/i)).toBeTruthy();
    // The whole EAF workflow is gone, not just disabled.
    expect(screen.queryByText("Submission Guide")).toBeNull();
    expect(screen.queryByText(/Submit Completed EAF/i)).toBeNull();
  });

  it("still renders the full EAF page for an in-flight application while the stage is current", () => {
    candidates = [candidate({ status: "ongoingSubmission" })];
    renderPage();

    expect(screen.queryByText("The Candidacy Application Stage has ended")).toBeNull();
    expect(screen.getByText("Submission Guide")).toBeTruthy();
    expect(screen.getByText(/Submit Completed EAF/i)).toBeTruthy();
  });

  it("hides the party re-apply button once the Application Stage has ended", () => {
    candidates = [
      candidate({
        status: "pending",
        partyAffiliation: "Unity Party",
        positionApprovalStatus: "presidentRejected",
      }),
    ];
    electionPeriod = { ...electionPeriod, lifecycleStage: "campaign", candidacyOpen: false };
    renderPage();

    expect(screen.getByText("Application Already Submitted")).toBeTruthy();
    expect(screen.getByText("Position already filled")).toBeTruthy();
    expect(screen.queryByText("Re-apply for this position")).toBeNull();
    expect(screen.getByText(/can no longer be re-applied for/i)).toBeTruthy();
  });

  it("keeps the party re-apply button while the Application Stage is current", () => {
    candidates = [
      candidate({
        status: "pending",
        partyAffiliation: "Unity Party",
        positionApprovalStatus: "presidentRejected",
      }),
    ];
    renderPage();

    expect(screen.getByText("Application Already Submitted")).toBeTruthy();
    expect(screen.getByText("Re-apply for this position")).toBeTruthy();
  });

  it("opens the prefilled wizard from Revise and Resubmit after a low-tier rejection (112)", async () => {
    candidates = [
      candidate({
        status: "rejected",
        rejectionTier: "low",
        rejectionReason: "Blurry EAF photo",
        homeAddress: "Purok 2 Brgy. Bagasbas Daet, Camarines Norte",
      }),
    ];
    renderPage();

    // 112 regression: the rejected-screen branch used to swallow the edit
    // state, so clicking the button re-rendered the rejection screen.
    fireEvent.click(screen.getByText("Revise and Resubmit"));

    expect(await screen.findByText("Edit EAF Information")).toBeTruthy();
    // The wizard really rendered — step 1 is on screen (chip + heading).
    expect(screen.getAllByText("Personal Information").length).toBeGreaterThan(0);
    expect(screen.queryByText("Application Rejected")).toBeNull();
  });
});
