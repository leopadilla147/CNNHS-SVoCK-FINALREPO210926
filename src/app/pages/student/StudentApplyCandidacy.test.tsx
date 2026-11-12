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

describe("StudentApplyCandidacy — revising a rejected founder's application", () => {
  const FOUNDER_PARTY = "Nagkakaisang Kabataan Party";
  const FOUNDER_PARTY_ID = "d4000000-0000-4000-8000-00000000abcd";

  // A low-severity-rejected President (party creator) whose saved row carries
  // everything steps 1-3 validate: the photo, the PSGC codes (111), and the
  // guardian contact.  partyId puts the founder's own party into the party
  // picker — the condition under which keeping their own party name used to
  // be rejected as a duplicate.
  function rejectedFounder(overrides: Partial<Candidate> = {}): Candidate {
    return candidate({
      status: "rejected",
      rejectionTier: "low",
      rejectionReason: "Blurry EAF photo",
      gradeLevel: "Grade 12",
      position: "President",
      partyId: FOUNDER_PARTY_ID,
      partyAffiliation: FOUNDER_PARTY,
      picture: "data:image/jpeg;base64,c2FtcGxl",
      addressProvinceCode: "0505000000",
      addressCityCode: "0505013000",
      addressBarangayCode: "0505013001",
      parentGuardianName: "Maria Reyes Dela Cruz",
      parentGuardianContact: "09187654321",
      ...overrides,
    });
  }

  async function openPartyStepOfRevision() {
    renderPage();
    fireEvent.click(screen.getByText("Revise and Resubmit"));
    expect(await screen.findByText("Edit EAF Information")).toBeTruthy();
    // Walk from step 1 to the Party Affiliation step; each Next validates
    // the prefilled profile steps.
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(
      await screen.findByText("Party Affiliation and Elective Position")
    ).toBeTruthy();
  }

  it("lets the founder keep their own party name without the duplicate error", async () => {
    candidates = [rejectedFounder()];
    await openPartyStepOfRevision();

    // The wizard prefills "create new party" mode with the founder's own
    // party name.  Leaving the step must not read that as a name clash.
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText(/This party already exists/i)).toBeNull();
    expect(
      await screen.findByText(/Answer in your own words/i)
    ).toBeTruthy();
  });

  it("locks the party and position fields during the revision", async () => {
    candidates = [rejectedFounder()];
    await openPartyStepOfRevision();

    // 124's update branch keeps party and position as originally filed, so
    // the revise wizard shows them read-only instead of letting the student
    // type a change the database would silently ignore.
    expect(screen.getByDisplayValue(FOUNDER_PARTY)).toBeDisabled();
    const partyTypeBlock = screen
      .getByText(/only your profile details can be revised/i)
      .closest("div") as HTMLElement;
    expect(partyTypeBlock.querySelector("select")).toBeDisabled();
  });

  it("locks the party picker for a regular party member revising too", async () => {
    candidates = [
      rejectedFounder({
        position: "Grade 12 Representative",
        positionApprovalStatus: "presidentApproved",
      }),
    ];
    await openPartyStepOfRevision();

    expect(screen.queryByText(/This party already exists/i)).toBeNull();
    const partyTypeBlock = screen
      .getByText(/only your profile details can be revised/i)
      .closest("div") as HTMLElement;
    expect(partyTypeBlock.querySelector("select")).toBeDisabled();
  });
});

describe("StudentApplyCandidacy — answer textbox junk guard (dots and spaces)", () => {
  // Reuse the revision fixture to reach the essay steps: the saved row carries
  // everything steps 1-3 validate, and its (empty) leadership profile prefills
  // the answer textboxes so the junk checks can be exercised directly.
  const ESSAY_50 = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
  const DESCRIPTION_25 = Array.from({ length: 25 }, (_, i) => `d${i}`).join(" ");
  const DESCRIPTION_3 = "one two three";

  function rejectedRow(overrides: Partial<Candidate> = {}): Candidate {
    return candidate({
      status: "rejected",
      rejectionTier: "low",
      rejectionReason: "Blurry EAF photo",
      gradeLevel: "Grade 12",
      position: "President",
      partyId: "d4000000-0000-4000-8000-00000000abcd",
      partyAffiliation: "Nagkakaisang Kabataan Party",
      picture: "data:image/jpeg;base64,c2FtcGxl",
      addressProvinceCode: "0505000000",
      addressCityCode: "0505013000",
      addressBarangayCode: "0505013001",
      parentGuardianName: "Maria Reyes Dela Cruz",
      parentGuardianContact: "09187654321",
      ...overrides,
    });
  }

  /** Walk the revise wizard to the Introductory Profile step (step 5 of 7). */
  async function openIntroductoryStep() {
    renderPage();
    fireEvent.click(screen.getByText("Revise and Resubmit"));
    expect(await screen.findByText("Edit EAF Information")).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText(/Answer in your own words/i)).toBeTruthy();
  }

  /** The textarea under the given question heading (labels carry no htmlFor). */
  function textareaUnder(labelPattern: RegExp): HTMLTextAreaElement {
    const label = screen.getByText(labelPattern).closest("div") as HTMLElement;
    return label.querySelector("textarea") as HTMLTextAreaElement;
  }

  async function fillIntroductoryStepValidly() {
    fireEvent.change(textareaUnder(/inspiring student leader/), { target: { value: ESSAY_50 } });
    fireEvent.change(textareaUnder(/Why are these skills applicable/), { target: { value: ESSAY_50 } });
    fireEvent.change(textareaUnder(/vision of the Learner Government/), { target: { value: ESSAY_50 } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Motivational/ }));
    fireEvent.click(screen.getByText("Next"));
    // AnimatePresence "wait" delays the next step's mount, and the step chip
    // exists at every step — the Part IV direction box proves the Leadership
    // Capsule fields are actually live.
    await screen.findByText("IV. Leadership Capsule");
  }

  it("rejects a punctuation-and-spaces-only introductory answer", async () => {
    candidates = [rejectedRow()];
    await openIntroductoryStep();

    fireEvent.change(textareaUnder(/inspiring student leader/), { target: { value: ". . . ." } });
    fireEvent.click(screen.getByText("Next"));

    expect(await screen.findByText(/must contain actual words — punctuation and spaces alone are not allowed/i)).toBeTruthy();
    // Still on the Introductory Profile step — the junk answer blocked the walk.
    expect(screen.getByText(/Answer in your own words/i)).toBeTruthy();
  });

  it("keeps the required message for an empty introductory answer", async () => {
    candidates = [rejectedRow()];
    await openIntroductoryStep();

    fireEvent.click(screen.getByText("Next"));

    expect(await screen.findByText("Leadership qualities is required.")).toBeTruthy();
  });

  it("requires the Leadership Capsule guide question and blocks junk-only input", async () => {
    candidates = [rejectedRow()];
    await openIntroductoryStep();
    await fillIntroductoryStepValidly();

    // Empty guide question is no longer accepted.
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Answer is required.")).toBeTruthy();

    // A "."-only answer is rejected with the junk-specific message.
    const capsuleQuestion = textareaUnder(/qualities that you believe can make a great leader/);
    fireEvent.change(capsuleQuestion, { target: { value: ". ." } });
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText(/Answer must contain actual words/i)).toBeTruthy();
  });

  it("rejects junk-only project fields and enforces the 25-word description floor", async () => {
    candidates = [rejectedRow()];
    await openIntroductoryStep();
    await fillIntroductoryStepValidly();

    // The guide question carries real words; the Maka-Diyos fields carry junk.
    fireEvent.change(textareaUnder(/qualities that you believe can make a great leader/), { target: { value: ESSAY_50 } });
    const projectInputs = screen.getAllByPlaceholderText("e.g., Outreach Program");
    const descriptionBoxes = screen.getAllByPlaceholderText("Describe the project/program...");
    expect(projectInputs).toHaveLength(4);
    expect(descriptionBoxes).toHaveLength(4);
    // Give every project a real name first; only the Maka-Diyos fields get junked below.
    for (const input of projectInputs) {
      fireEvent.change(input, { target: { value: "Outreach Program" } });
    }
    fireEvent.change(projectInputs[0], { target: { value: "." } });
    fireEvent.change(descriptionBoxes[0], { target: { value: ". . ." } });
    fireEvent.click(screen.getByText("Next"));

    expect(await screen.findByText(/Project name must contain actual words/i)).toBeTruthy();
    expect(await screen.findByText(/Description must contain actual words/i)).toBeTruthy();

    // Real words below the floor get the honest count (dots no longer count as words).
    fireEvent.change(projectInputs[0], { target: { value: "Outreach Program" } });
    fireEvent.change(descriptionBoxes[0], { target: { value: DESCRIPTION_3 } });
    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Description must be at least 25 words (3/25).")).toBeTruthy();

    // Meeting the floor on every description lets the walk proceed to step 7.
    for (const box of screen.getAllByPlaceholderText("Describe the project/program...")) {
      fireEvent.change(box, { target: { value: DESCRIPTION_25 } });
    }
    fireEvent.click(screen.getByText("Next"));
    // Step 7's own instruction text — the chip label exists at every step.
    expect(await screen.findByText(/Review the summary of your information/)).toBeTruthy();
  });
});
