// AdminStudents.test.tsx
// =============================================================
// RTL over the REAL AdminStudents component (MASTER-01 upload) in the
// vitest jsdom harness.  The supabase modules are mocked so the test
// never hits the network; the masterlist PARSER is mocked at the file
// boundary (extractAndParseMasterlist) while the real skip-message
// helper (describeSkippedLrn) still words the banner.
//
// Covers the partial-import flow:
//  - valid new rows import (count reported)
//  - rows whose LRN already exists are SKIPPED, not re-uploaded (count
//    + per-row reasons reported)
//  - invalid rows are reported with row numbers and fix guidance while
//    the valid rows still import
//  - a matched PENDING registration is still auto-approved from the
//    same upload
//  - "rows inserted" + "awaiting registration" share ONE combined
//    banner line (adaptive wording per count combination)
// =============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import AdminStudents from "./AdminStudents";
import type { MasterlistRow } from "../../lib/masterlistDocx";

const {
  mockSetStudents,
  mockSetStudentMasterlist,
  mockAddLog,
  mockInsertNotification,
  mockReviewStudentRpc,
  mockImportStudentMasterlistDocx,
  mockFindExistingLrns,
  mockExtractAndParse,
  mockVerifyAdviserPassword,
  mockDisableStudentAccounts,
} = vi.hoisted(() => ({
  mockSetStudents: vi.fn(),
  mockSetStudentMasterlist: vi.fn(),
  mockAddLog: vi.fn(),
  mockInsertNotification: vi.fn(),
  mockReviewStudentRpc: vi.fn(),
  mockImportStudentMasterlistDocx: vi.fn(),
  mockFindExistingLrns: vi.fn(),
  mockExtractAndParse: vi.fn(),
  mockVerifyAdviserPassword: vi.fn(),
  mockDisableStudentAccounts: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(""), vi.fn()],
  };
});

vi.mock("../../context/AppContext", () => ({
  useApp: () => ({
    currentUser: { id: "adv-1", name: "Adviser Adviser", role: "sslg_adviser" },
    students: [
      {
        id: "s333",
        lrn: "333333333333",
        firstName: "Juan",
        lastName: "Dela Cruz",
        birthdate: "2009-05-14",
        gender: "Male",
        gradeLevel: "Grade 7",
        status: "pending",
        verificationStatus: "manual",
        mismatchCount: 0,
        email: "juan.delacruz@cnnhs.edu",
        registeredAt: "2026-10-27",
      },
      {
        id: "s777",
        lrn: "777777777777",
        firstName: "Maria",
        lastName: "Santos",
        birthdate: "2010-02-22",
        gender: "Female",
        gradeLevel: "Grade 8",
        status: "approved",
        verificationStatus: "automatic",
        email: "maria.santos@cnnhs.edu",
        registeredAt: "2026-10-20",
      },
    ],
    setStudents: mockSetStudents,
    addLog: mockAddLog,
    insertNotification: mockInsertNotification,
    studentMasterlist: [],
    setStudentMasterlist: mockSetStudentMasterlist,
    electionPeriod: undefined,
  }),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: true,
}));

// Only the file boundary is mocked — the real describeSkippedLrn words
// the banner messages.
vi.mock("../../lib/masterlistDocx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/masterlistDocx")>();
  return {
    ...actual,
    extractAndParseMasterlist: mockExtractAndParse,
  };
});

vi.mock("../../lib/supabaseData", () => ({
  reviewStudentRpc: mockReviewStudentRpc,
  importStudentMasterlistDocx: mockImportStudentMasterlistDocx,
  findExistingLrns: mockFindExistingLrns,
  verifyAdviserPasswordRpc: mockVerifyAdviserPassword,
  disableStudentAccountsRpc: mockDisableStudentAccounts,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const row = (lrn: string, sheetRow: number): MasterlistRow => ({
  lrn,
  fullName: "Dela Cruz, Juan A.",
  birthdate: "05/14/2009",
  gradeSection: "7 - SAMPAGUITA",
  strand: "STEM",
  sex: "Male",
  gradeLevel: "Grade 7",
  section: "SAMPAGUITA",
  parentGuardian: "",
  adviser: "",
  sheetRow,
});

function renderPage() {
  return render(<AdminStudents />);
}

function uploadFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "masterlist.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })] },
  });
}

/** The parsed sheet is staged in a confirmation dialog (Radix renders it
 *  with role="alertdialog"); confirming is what writes to the masterlist. */
async function confirmMasterlistDialog() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /Add to Masterlist/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReviewStudentRpc.mockResolvedValue(undefined);
  mockImportStudentMasterlistDocx.mockResolvedValue({ imported: 0, skipped: 0, errors: [] });
  mockFindExistingLrns.mockResolvedValue(new Map());
  mockVerifyAdviserPassword.mockResolvedValue(true);
  mockDisableStudentAccounts.mockResolvedValue({ disabled: 1 });
  // Parsed sheet: Row 2 valid+new, Row 3 valid+listed, Row 4 valid+registered,
  // Row 5 invalid (reported by the parser), Row 6 valid+new.
  mockExtractAndParse.mockResolvedValue({
    parsed: {
      rows: [row("111111111111", 2), row("222222222222", 3), row("333333333333", 4), row("444444444444", 6)],
      skipped: 1,
      errors: [
        "Row 5: missing Sex/Gender (Male or Female) — this row was not imported. Fix the highlighted details and upload the sheet again.",
      ],
    },
    text: "STUDENT MASTER LIST\nSY: 2026-2027",
  });
  // 222 is already on the masterlist; 333 is already a registered account.
  mockFindExistingLrns.mockResolvedValue(
    new Map([
      ["222222222222", { reason: "listed" as const, detail: "enrolled" }],
      ["333333333333", { reason: "registered" as const, detail: "approved" }],
    ])
  );
  mockImportStudentMasterlistDocx.mockResolvedValue({ imported: 2, skipped: 0, errors: [] });
});

describe("AdminStudents masterlist upload (partial import)", () => {
  it("imports only new rows, skips existing LRNs, and reports invalid rows with fix guidance", async () => {
    const { container } = renderPage();
    uploadFile(container);
    await confirmMasterlistDialog();

    // Inserted + awaiting share ONE combined box: 2 new rows imported, but
    // 3 students have no registered account yet (222 was already listed).
    expect(
      await screen.findByText("2 masterlist rows inserted; 3 students listed as awaiting student registration.")
    ).toBeInTheDocument();
    // The matched registration's auto-approval keeps its own (green) box.
    expect(
      screen.getByText("1 registered student auto-approved via the masterlist match.")
    ).toBeInTheDocument();

    // Skipped-duplicates count + per-row reasons (real describeSkippedLrn)
    expect(
      screen.getByText("2 rows skipped — their LRNs already exist in the system, so they were not re-uploaded:")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Row 3: LRN 222222222222 already on the Student Masterlist (awaiting registration) — skipped, not re-uploaded.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Row 4: LRN 333333333333 already registered (approved account) — skipped, not re-uploaded.")
    ).toBeInTheDocument();

    // Invalid-row handler with row numbers + fix guidance
    expect(
      screen.getByText("1 row could not be imported — the valid rows were still imported. Fix the highlighted rows and upload the sheet again:")
    ).toBeInTheDocument();
    expect(screen.getByText(/Row 5: missing Sex\/Gender/)).toBeInTheDocument();
    expect(screen.getByText(/Each row needs: a 12-digit LRN/)).toBeInTheDocument();

    // Only the NEW rows reached the import call (222 and 333 excluded).
    await waitFor(() => expect(mockImportStudentMasterlistDocx).toHaveBeenCalledTimes(1));
    const [importRows, schoolYear] = mockImportStudentMasterlistDocx.mock.calls[0];
    expect(schoolYear).toBe("2026-2027");
    expect(importRows.map((r: MasterlistRow) => r.lrn)).toEqual(["111111111111", "444444444444"]);

    // The matched PENDING registration was auto-approved from the same upload.
    expect(mockReviewStudentRpc).toHaveBeenCalledWith("s333", "approve", "adv-1", "automatic");
    expect(mockInsertNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "s333", type: "student_approved" })
    );
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Masterlist Imported" })
    );
  });

  it("reports nothing imported when every row is invalid", async () => {
    mockExtractAndParse.mockResolvedValue({
      parsed: {
        rows: [],
        skipped: 2,
        errors: [
          "Row 2: invalid LRN — must be exactly 12 digits, numbers only — this row was not imported. Fix the highlighted details and upload the sheet again.",
          "Row 3: missing Full Name (Last Name, First Name, Middle Initial) — this row was not imported. Fix the highlighted details and upload the sheet again.",
        ],
      },
      text: "STUDENT MASTER LIST\nSY: 2026-2027",
    });

    const { container } = renderPage();
    uploadFile(container);

    // Nothing valid to add — the confirmation dialog is never offered.
    expect(
      await screen.findByText("2 rows could not be imported — nothing was imported. Fix the highlighted rows and upload the sheet again:")
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mockImportStudentMasterlistDocx).not.toHaveBeenCalled();
  });

  it("collapses the combined line on a fresh upload where inserted === awaiting", async () => {
    // Fresh sheet: both rows are new and none matches a registered LRN,
    // so inserted (2) and awaiting (2) are the same rows reported once.
    mockExtractAndParse.mockResolvedValue({
      parsed: {
        rows: [row("111111111111", 2), row("222222222222", 3)],
        skipped: 0,
        errors: [],
      },
      text: "STUDENT MASTER LIST\nSY: 2026-2027",
    });
    mockFindExistingLrns.mockResolvedValue(new Map());
    mockImportStudentMasterlistDocx.mockResolvedValue({ imported: 2, skipped: 0, errors: [] });

    const { container } = renderPage();
    uploadFile(container);
    await confirmMasterlistDialog();

    expect(
      await screen.findByText("2 masterlist rows inserted — all listed as awaiting student registration.")
    ).toBeInTheDocument();
    // Nothing matched a registered account — no green box.
    expect(screen.queryByText(/auto-approved via the masterlist match/)).toBeNull();
  });

  it("keeps the inserted-only line when the new row matches a registered student", async () => {
    // LRN 777 belongs to registered Maria Santos, but the sheet's details
    // differ (name/birthdate/grade) → forReview, NOT auto-approved and
    // NOT awaiting: only the insert count has anything to report.
    mockExtractAndParse.mockResolvedValue({
      parsed: {
        rows: [row("777777777777", 2)],
        skipped: 0,
        errors: [],
      },
      text: "STUDENT MASTER LIST\nSY: 2026-2027",
    });
    mockFindExistingLrns.mockResolvedValue(new Map());
    mockImportStudentMasterlistDocx.mockResolvedValue({ imported: 1, skipped: 0, errors: [] });

    const { container } = renderPage();
    uploadFile(container);
    await confirmMasterlistDialog();

    expect(await screen.findByText("1 masterlist row inserted.")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting student registration/)).toBeNull();
    expect(mockReviewStudentRpc).not.toHaveBeenCalled();
  });

  it("stages the parsed sheet behind a confirmation dialog and adds nothing until confirmed", async () => {
    const { container } = renderPage();
    uploadFile(container);

    // The summary dialog appears first; the import call has NOT happened.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Add These Students to the Masterlist?")).toBeInTheDocument();
    expect(within(dialog).getByText("New rows to add")).toBeInTheDocument();
    // The dialog lists exactly the students that will be added — the two
    // NEW rows with their LRNs; the skipped (already-in-system) rows 222
    // and 333 are not offered.
    expect(within(dialog).getByText("Students to be added")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Dela Cruz, Juan A.")).toHaveLength(2);
    expect(within(dialog).getByText("LRN: 111111111111")).toBeInTheDocument();
    expect(within(dialog).getByText("LRN: 444444444444")).toBeInTheDocument();
    expect(within(dialog).queryByText("LRN: 222222222222")).toBeNull();
    expect(within(dialog).queryByText("LRN: 333333333333")).toBeNull();
    expect(mockImportStudentMasterlistDocx).not.toHaveBeenCalled();

    // Cancelling aborts the import — no rows written, no auto-approvals,
    // and the cancellation is audited.
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    await waitFor(() =>
      expect(mockAddLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "Masterlist Import Cancelled", type: "info" })
      )
    );
    expect(mockImportStudentMasterlistDocx).not.toHaveBeenCalled();
    expect(mockReviewStudentRpc).not.toHaveBeenCalled();
    expect(mockSetStudentMasterlist).not.toHaveBeenCalled();
  });

  it("shows the in-page error banner, toast, and audit entry when the import fails", async () => {
    mockImportStudentMasterlistDocx.mockRejectedValue(new Error("The database rejected the import."));
    const { container } = renderPage();
    uploadFile(container);
    await confirmMasterlistDialog();

    // In-page red banner (role="alert") with the failure reason.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Masterlist upload failed — nothing was added.")).toBeInTheDocument();
    expect(screen.getByText("The database rejected the import.")).toBeInTheDocument();
    // Toast + error audit entry.
    expect(toast.error).toHaveBeenCalledWith("The database rejected the import.");
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Masterlist Import Failed", type: "error" })
    );
    // No local masterlist state was mutated by the failed import.
    expect(mockSetStudentMasterlist).not.toHaveBeenCalled();
  });
});

describe("AdminStudents disable student accounts (107)", () => {
  it("removes the Rejected stat card and filter chip", () => {
    renderPage();
    // The filter chip and the stats label are gone…
    expect(screen.queryByText("rejected")).toBeNull();
    expect(screen.queryByText("Rejected")).toBeNull();
    // …while the surviving chips remain.
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("gates the panel behind the SSLG Adviser password and refuses the wrong one", async () => {
    mockVerifyAdviserPassword.mockRejectedValue(new Error("The SSLG Adviser password was not accepted."));

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Disable Student Accounts/i }));

    const dialog = await screen.findByRole("dialog");
    const password = within(dialog).getByLabelText("SSLG Adviser Password") as HTMLInputElement;

    // Empty password -> inline error, RPC never called.
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));
    expect(await screen.findByText("Enter the SSLG Adviser password to continue.")).toBeInTheDocument();
    expect(mockVerifyAdviserPassword).not.toHaveBeenCalled();

    // Wrong password -> the gate stays up with the server's message.
    fireEvent.change(password, { target: { value: "wrong-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));
    expect(await screen.findByText("The SSLG Adviser password was not accepted.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Reason")).toBeNull();
    expect(mockVerifyAdviserPassword).toHaveBeenCalledTimes(1);
  });

  it("disables the selected approved accounts after the password gate", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Disable Student Accounts/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("SSLG Adviser Password"), {
      target: { value: "adviser-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));

    // The panel appears only after the gate accepted the password.
    expect(await screen.findByText("Reason")).toBeInTheDocument();
    expect(mockVerifyAdviserPassword).toHaveBeenCalledWith("adviser-password");

    // Only APPROVED, not-yet-disabled accounts are listed — the pending
    // student is not offered.
    expect(within(dialog).getByText("Maria Santos")).toBeInTheDocument();
    expect(within(dialog).queryByText("Juan Dela Cruz")).toBeNull();

    // Transferred mode: manual pick + search only — no masterlist upload.
    fireEvent.click(within(dialog).getByRole("button", { name: /Transferring to Another School/i }));
    expect(within(dialog).queryByText(/Upload Graduated Masterlist/i)).toBeNull();

    // Pick "Transferring to Another School", select the student, submit.
    fireEvent.click(within(dialog).getByRole("button", { name: /Transferring to Another School/i }));
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /Disable 1 Account/i }));

    await waitFor(() =>
      expect(mockDisableStudentAccounts).toHaveBeenCalledWith(
        ["s777"],
        "transferred",
        "adviser-password"
      )
    );
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "Student Accounts Disabled",
        details: expect.stringContaining("Transferred to another school"),
      })
    );
    // The dialog closes and the local state marks the account disabled.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const updatedStudents = mockSetStudents.mock.calls[0][0] as Array<{ id: string; disabled?: boolean; disabledReason?: string }>;
    expect(updatedStudents.find((s) => s.id === "s777")).toMatchObject({
      disabled: true,
      disabledReason: "transferred",
    });
    expect(updatedStudents.find((s) => s.id === "s333")?.disabled ?? false).toBe(false);
  });

  it("auto-selects matching students from an uploaded graduated masterlist and shows the summary", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Disable Student Accounts/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("SSLG Adviser Password"), {
      target: { value: "adviser-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));

    expect(await screen.findByText("Reason")).toBeInTheDocument();

    // Graduated is the default reason — the upload control is offered and
    // the summary starts empty.
    expect(within(dialog).getByText(/Upload Graduated Masterlist/i)).toBeInTheDocument();
    expect(within(dialog).getByText("No students selected yet.")).toBeInTheDocument();

    // Sheet: LRN 777… matches the approved s777; 999… has no approved account.
    mockExtractAndParse.mockResolvedValueOnce({
      parsed: {
        rows: [row("777777777777", 2), row("999999999999", 3)],
        skipped: 0,
        errors: [],
      },
      text: "STUDENT MASTER LIST\nSY: 2026-2027",
    });
    const dialogFileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(dialogFileInput, {
      target: { files: [new File(["x"], "graduated.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })] },
    });

    // The match lands in the summary beside the controls (regex matchers —
    // the report div's full text also carries the skip sentence).
    expect(await screen.findByText(/1 student matched and selected\./)).toBeInTheDocument();
    expect(screen.getByText(/skipped: 999999999999/)).toBeInTheDocument();
    // She appears twice: in the checkbox list AND in the summary beside it.
    expect(within(dialog).getAllByText("Maria Santos").length).toBe(2);

    // Submitting disables exactly the matched account.
    fireEvent.click(within(dialog).getByRole("button", { name: /Disable 1 Account/i }));
    await waitFor(() =>
      expect(mockDisableStudentAccounts).toHaveBeenCalledWith(
        ["s777"],
        "graduated",
        "adviser-password"
      )
    );
  });

  it("lets the adviser remove a selection from the summary", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Disable Student Accounts/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("SSLG Adviser Password"), {
      target: { value: "adviser-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continue/i }));
    expect(await screen.findByText("Reason")).toBeInTheDocument();

    // Select manually, then remove from the summary.
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByText(/Selected for Disable/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTitle(/Remove Maria Santos from the list/));

    expect(await screen.findByText("No students selected yet.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Disable Accounts?$/i })).toBeDisabled();
  });
});
