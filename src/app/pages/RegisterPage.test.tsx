// RegisterPage.test.tsx
// =============================================================
// RTL over the REAL RegisterPage component inside the vitest jsdom
// harness.  The supabase modules are mocked so the tests never hit
// the network, and useConfirm is mocked to auto-confirm (the repo
// pattern used by StudentProfile/AdminCandidates tests).
//
// Covers the LRN-first redesign (REG-LRN-01):
//  - field order: LRN -> Name row -> Grade/Gender/Birthdate row
//  - approved LRN   -> blocked (banner + disabled submit, no insert)
//  - masterlist LRN -> locked exact-match rule: mismatch blocks the
//    registration before anything is stored, exact match auto-approves
//  - unknown LRN    -> submits and waits for SSLG Adviser review
// =============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RegisterPage from "./RegisterPage";

const {
  mockSetStudents,
  mockAddLog,
  mockNavigate,
  mockRegisterStudentDirect,
  mockCheckLrnRegistration,
  mockGetMasterlistRecord,
  mockConfirm,
} = vi.hoisted(() => ({
  mockSetStudents: vi.fn(),
  mockAddLog: vi.fn(),
  mockNavigate: vi.fn(),
  mockRegisterStudentDirect: vi.fn(),
  mockCheckLrnRegistration: vi.fn(),
  mockGetMasterlistRecord: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../context/AppContext", () => ({
  useApp: () => ({ students: [], setStudents: mockSetStudents, addLog: mockAddLog }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: true,
}));

// Keep the REAL matchesMasterlistRecord — only the network helpers are mocked.
vi.mock("../lib/supabaseData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/supabaseData")>();
  return {
    ...actual,
    registerStudentDirect: mockRegisterStudentDirect,
    checkLrnRegistration: mockCheckLrnRegistration,
    getMasterlistRecord: mockGetMasterlistRecord,
  };
});

vi.mock("../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

const LRN = "123456789012";

const MASTER_RECORD = {
  id: "m-1",
  first_name: "Maria",
  middle_name: "Cruz",
  last_name: "Santos",
  birthdate: "2012-05-01",
  grade_level: "Grade 7",
  gender: "Female",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

function typeLrn(value = LRN) {
  fireEvent.change(screen.getByPlaceholderText("12-digit LRN"), { target: { value } });
}

// The birthdate is three dropdowns (month / day / year) sized to fit the date.
function setBirthdate(ymd: string) {
  const [year, month, day] = ymd.split("-").map((part) => String(parseInt(part, 10)));
  fireEvent.change(screen.getByLabelText("Birth month"), { target: { value: month } });
  fireEvent.change(screen.getByLabelText("Birth day"), { target: { value: day } });
  fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: year } });
}

function fillRegistrationForm(overrides: Record<string, string> = {}) {
  const v = {
    firstName: "Maria",
    middleName: "Cruz",
    lastName: "Santos",
    grade: "Grade 7",
    gender: "Female",
    birthdate: "2012-05-01",
    email: "maria.santos@cnnhs.edu",
    password: "secret123",
    ...overrides,
  };
  fireEvent.change(screen.getByPlaceholderText("e.g. Maria"), { target: { value: v.firstName } });
  fireEvent.change(screen.getByPlaceholderText("e.g. Cruz"), { target: { value: v.middleName } });
  fireEvent.change(screen.getByPlaceholderText("e.g. Santos"), { target: { value: v.lastName } });
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: v.grade } });
  fireEvent.change(selects[1], { target: { value: v.gender } });
  setBirthdate(v.birthdate);
  fireEvent.change(screen.getByPlaceholderText("your.email@example.com"), {
    target: { value: v.email },
  });
  fireEvent.change(screen.getByPlaceholderText("Min. 6 characters"), {
    target: { value: v.password },
  });
  fireEvent.change(screen.getByPlaceholderText("Re-enter password"), {
    target: { value: v.password },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfirm.mockResolvedValue(true);
});

describe("RegisterPage (LRN-first redesign)", () => {
  it("renders LRN first, then the name row, then grade/gender/birthdate in one 3-column row", () => {
    renderPage();

    const lrn = screen.getByPlaceholderText("12-digit LRN");
    const firstName = screen.getByPlaceholderText("e.g. Maria");
    const grade = screen.getAllByRole("combobox")[0];
    const gender = screen.getAllByRole("combobox")[1];
    const birthdate = screen.getByLabelText("Birth month");

    // LRN -> Name row -> Grade/Gender/Birthdate row (document order)
    expect(lrn.compareDocumentPosition(firstName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const nameRow = firstName.closest('[class*="sm:grid-cols-3"]');
    const detailRow = grade.closest('[class*="sm:grid-cols-3"]');
    expect(nameRow).toBeTruthy();
    expect(detailRow).toBeTruthy();
    expect(nameRow).not.toBe(detailRow);
    expect(nameRow!.compareDocumentPosition(detailRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lrn.compareDocumentPosition(nameRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Grade Level, Gender and Birthdate sit in the same one-line 3-column row
    expect(detailRow!.className).toContain("sm:grid-cols-3");
    expect(detailRow!.children.length).toBe(3);
    expect(detailRow!.contains(gender)).toBe(true);
    expect(detailRow!.contains(birthdate)).toBe(true);
  });

  it("only offers birth years inside the 5-100 year age window", () => {
    renderPage();

    const year = screen.getByLabelText("Birth year") as HTMLSelectElement;
    const values = Array.from(year.options)
      .map((o) => o.value)
      .filter(Boolean)
      .map(Number);
    const currentYear = new Date().getFullYear();

    // Newest first, five years back at the top, one hundred years back at the
    // bottom — recent and future dates are never offered.
    expect(Math.max(...values)).toBe(currentYear - 5);
    expect(Math.min(...values)).toBe(currentYear - 100);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("limits the day options to the selected month's length (leap years included)", () => {
    renderPage();

    const month = screen.getByLabelText("Birth month") as HTMLSelectElement;
    const year = screen.getByLabelText("Birth year") as HTMLSelectElement;
    const day = screen.getByLabelText("Birth day") as HTMLSelectElement;
    const dayCount = () => Array.from(day.options).filter((o) => o.value !== "").length;

    fireEvent.change(month, { target: { value: "2" } }); // February
    fireEvent.change(year, { target: { value: "2021" } }); // non-leap
    expect(dayCount()).toBe(28);
    fireEvent.change(year, { target: { value: "2020" } }); // leap year
    expect(dayCount()).toBe(29);
  });

  it("blocks registration when the birthdate falls inside the last 5 years", () => {
    // Pin "today" so the under-5 scenario is deterministic (on the real
    // Dec 31 the dropdown cannot even offer an under-5 date).
    vi.useFakeTimers({ now: new Date(2026, 10, 9) });
    try {
      mockCheckLrnRegistration.mockResolvedValue({
        inStudents: false,
        studentStatus: null,
        inMasterlist: false,
      });

      renderPage();
      typeLrn();

      // Late in the oldest offered year (currentYear - 5): selectable in the
      // dropdown, but the exact date is still under the 5-year age floor.
      fillRegistrationForm({ birthdate: "2021-12-15" });
      fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));

      expect(screen.getByText(/dates within the last 5 years are not allowed/i)).toBeInTheDocument();
      expect(mockRegisterStudentDirect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks registration when the LRN is already approved", async () => {
    mockCheckLrnRegistration.mockResolvedValue({
      inStudents: true,
      studentStatus: "approved",
      inMasterlist: false,
    });

    renderPage();
    typeLrn();

    await waitFor(
      () => expect(screen.getByText(/already registered and approved/i)).toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(screen.getByRole("button", { name: "Submit Registration" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));
    expect(mockRegisterStudentDirect).not.toHaveBeenCalled();
  });

  it("blocks submission when the LRN is in the masterlist but the details do not match", async () => {
    mockCheckLrnRegistration.mockResolvedValue({
      inStudents: false,
      studentStatus: null,
      inMasterlist: true,
    });
    mockGetMasterlistRecord.mockResolvedValue(MASTER_RECORD);

    renderPage();
    typeLrn();
    await waitFor(
      () => expect(screen.getByText(/LRN found in the/i)).toBeInTheDocument(),
      { timeout: 2000 },
    );

    fillRegistrationForm({ grade: "Grade 8" }); // wrong grade level on purpose
    fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));

    await waitFor(() =>
      expect(screen.getByText(/do not match the Student Masterlist record/i)).toBeInTheDocument(),
    );
    expect(mockRegisterStudentDirect).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("registers and auto-approves on an exact masterlist match", async () => {
    mockCheckLrnRegistration.mockResolvedValue({
      inStudents: false,
      studentStatus: null,
      inMasterlist: true,
    });
    mockGetMasterlistRecord.mockResolvedValue(MASTER_RECORD);
    mockRegisterStudentDirect.mockResolvedValue({
      id: "s-1",
      firstName: "Maria",
      middleName: "Cruz",
      lastName: "Santos",
      gradeLevel: "Grade 7",
      gender: "Female",
      birthdate: "2012-05-01",
      lrn: LRN,
      email: "maria.santos@cnnhs.edu",
      status: "approved",
      registeredAt: "2026-10-27",
    });

    renderPage();
    typeLrn();
    await waitFor(
      () => expect(screen.getByText(/LRN found in the/i)).toBeInTheDocument(),
      { timeout: 2000 },
    );

    fillRegistrationForm();
    fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));

    await waitFor(() => expect(mockRegisterStudentDirect).toHaveBeenCalledTimes(1));
    expect(mockRegisterStudentDirect).toHaveBeenCalledWith({
      firstName: "Maria",
      middleName: "Cruz",
      lastName: "Santos",
      gradeLevel: "Grade 7",
      gender: "Female",
      birthdate: "2012-05-01",
      lrn: LRN,
      email: "maria.santos@cnnhs.edu",
      password: "secret123",
    });
    expect(await screen.findByText("Registration Submitted!")).toBeInTheDocument();
    expect(screen.getByText(/automatically approved/i)).toBeInTheDocument();
  });

  it("locks the Middle Name input when the masterlist record has no middle name", async () => {
    mockCheckLrnRegistration.mockResolvedValue({
      inStudents: false,
      studentStatus: null,
      inMasterlist: true,
    });
    mockGetMasterlistRecord.mockResolvedValue({ ...MASTER_RECORD, middle_name: null });
    mockRegisterStudentDirect.mockResolvedValue({
      id: "s-3",
      firstName: "Maria",
      lastName: "Santos",
      gradeLevel: "Grade 7",
      gender: "Female",
      birthdate: "2012-05-01",
      lrn: LRN,
      email: "maria.santos@cnnhs.edu",
      status: "approved",
      registeredAt: "2026-10-27",
    });

    renderPage();
    typeLrn();
    await waitFor(
      () => expect(screen.getByText(/LRN found in the/i)).toBeInTheDocument(),
      { timeout: 2000 },
    );

    // No middle name on the masterlist record -> the input is disabled and
    // explains why, while the other name fields stay editable.
    const middleName = screen.getByPlaceholderText("e.g. Cruz") as HTMLInputElement;
    expect(middleName).toBeDisabled();
    expect(screen.getByText(/Not on your masterlist record/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Maria")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("e.g. Santos")).not.toBeDisabled();

    // An exact match without a middle name still registers and auto-approves.
    fillRegistrationForm({ middleName: "" });
    fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));

    await waitFor(() => expect(mockRegisterStudentDirect).toHaveBeenCalledTimes(1));
    expect(mockRegisterStudentDirect).toHaveBeenCalledWith(
      expect.objectContaining({ middleName: undefined, firstName: "Maria", lastName: "Santos" }),
    );
    expect(await screen.findByText("Registration Submitted!")).toBeInTheDocument();
    expect(screen.getByText(/automatically approved/i)).toBeInTheDocument();
  });

  it("submits as pending for SSLG Adviser review when the LRN is not in the system", async () => {
    mockCheckLrnRegistration.mockResolvedValue({
      inStudents: false,
      studentStatus: null,
      inMasterlist: false,
    });
    mockRegisterStudentDirect.mockResolvedValue({
      id: "s-2",
      firstName: "Juan",
      lastName: "Dela Cruz",
      gradeLevel: "Grade 8",
      gender: "Male",
      birthdate: "2011-03-15",
      lrn: LRN,
      email: "juan.delacruz@cnnhs.edu",
      status: "pending",
      registeredAt: "2026-10-27",
    });

    renderPage();
    typeLrn();

    const banner = await screen.findByText(
      /not found in the system or the Student Masterlist/i,
      {},
      { timeout: 2000 },
    );
    expect(banner).toBeInTheDocument();

    fillRegistrationForm({
      firstName: "Juan",
      lastName: "Dela Cruz",
      grade: "Grade 8",
      gender: "Male",
      birthdate: "2011-03-15",
      email: "juan.delacruz@cnnhs.edu",
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Registration" }));

    await waitFor(() => expect(mockRegisterStudentDirect).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Registration Submitted!")).toBeInTheDocument();
    expect(screen.getByText(/awaiting SSLG Adviser review/i)).toBeInTheDocument();
  });
});
