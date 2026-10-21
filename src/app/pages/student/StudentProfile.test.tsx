import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentProfile from "./StudentProfile";
import type { Student } from "../../context/AppContext";

// The page reads everything through useApp, so it renders against a flat
// context stub — no provider, no Supabase (same pattern as
// StudentDashboard.test.tsx).

const { mockConfirm, mockUploadStudentPicture, mockUpdatePictureRpc, mockDeletePictureRpc, mockUseApp } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockUploadStudentPicture: vi.fn(),
  mockUpdatePictureRpc: vi.fn(),
  mockDeletePictureRpc: vi.fn(),
  mockUseApp: vi.fn(),
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../lib/supabaseData", () => ({
  updateStudentPassword: vi.fn(),
  uploadStudentPicture: mockUploadStudentPicture,
  updateMyProfilePictureRpc: mockUpdatePictureRpc,
  deleteStudentPictureRpc: mockDeletePictureRpc,
}));

vi.mock("../../context/AppContext", () => ({
  useApp: mockUseApp,
}));

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "student-1",
    firstName: "Juan",
    lastName: "Dela Cruz",
    gradeLevel: "Grade 10",
    gender: "Male",
    birthdate: "2010-05-01",
    lrn: "123456789012",
    status: "approved",
    email: "juan@cnnhs.edu",
    registeredAt: "2026-06-01",
    ...overrides,
  };
}

function stubContext(students: Student[]) {
  mockUseApp.mockReturnValue({
    currentUser: { id: "student-1", name: "Juan Dela Cruz", role: "student" },
    students,
    candidates: [],
    logs: [],
    setCurrentUser: vi.fn(),
    setStudents: vi.fn(),
  });
}

function renderProfile() {
  return render(<StudentProfile />);
}

/** The camera button drives a hidden file input; go straight to it. */
function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("StudentProfile picture avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    stubContext([student()]);
  });

  it("falls back to initials when no picture is set", () => {
    const { container } = renderProfile();

    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(container.querySelector('img[alt="Juan Dela Cruz"]')).toBeNull();
  });

  it("renders the stored photo instead of initials when one is set", () => {
    stubContext([student({ profilePictureUrl: "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1.jpg" })]);
    const { container } = renderProfile();

    const img = container.querySelector('img[alt="Juan Dela Cruz"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("student-pictures/student_1.jpg");
    expect(screen.queryByText("JD")).toBeNull();
  });

  it("offers a remove button only when a picture is set", () => {
    const { rerender } = renderProfile();
    expect(screen.queryByRole("button", { name: /Remove picture/ })).toBeNull();

    stubContext([student({ profilePictureUrl: "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1.jpg" })]);
    rerender(<StudentProfile />);

    expect(screen.getByRole("button", { name: /Remove picture/ })).toBeTruthy();
  });

  it("rejects an image larger than the 2 MB bucket limit", async () => {
    const { container } = renderProfile();
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });

    pickFile(container, big);

    await waitFor(() => expect(screen.getByText("Image must be 2 MB or smaller.")).toBeInTheDocument());
    expect(mockUploadStudentPicture).not.toHaveBeenCalled();
  });

  it("rejects a non-image file", async () => {
    const { container } = renderProfile();
    const doc = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    pickFile(container, doc);

    await waitFor(() =>
      expect(screen.getByText("Only JPEG, PNG, or WebP images are allowed.")).toBeInTheDocument(),
    );
    expect(mockUploadStudentPicture).not.toHaveBeenCalled();
  });

  it("uploads, persists via the RPC and refreshes context on confirm", async () => {
    const setStudents = vi.fn();
    mockUseApp.mockReturnValue({
      currentUser: { id: "student-1", name: "Juan Dela Cruz", role: "student" },
      students: [student()],
      candidates: [],
      logs: [],
      setCurrentUser: vi.fn(),
      setStudents,
    });
    const url = "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1_1.jpg";
    mockUploadStudentPicture.mockResolvedValue(url);
    mockUpdatePictureRpc.mockResolvedValue({});

    const { container } = renderProfile();
    const pic = new File(["(oo)"], "me.png", { type: "image/png" });
    pickFile(container, pic);

    await waitFor(() => expect(mockUploadStudentPicture).toHaveBeenCalledWith("student-1", pic));
    await waitFor(() => expect(mockUpdatePictureRpc).toHaveBeenCalledWith(url));
    await waitFor(() =>
      expect(setStudents).toHaveBeenCalledWith([
        expect.objectContaining({ id: "student-1", profilePictureUrl: url }),
      ]),
    );
    // No previous picture -> nothing to clean up in storage.
    expect(mockDeletePictureRpc).not.toHaveBeenCalled();
  });

  it("skips the upload when the confirm dialog is cancelled", async () => {
    mockConfirm.mockResolvedValue(false);
    const { container } = renderProfile();
    const pic = new File(["(oo)"], "me.png", { type: "image/png" });

    pickFile(container, pic);

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockUploadStudentPicture).not.toHaveBeenCalled();
    expect(mockUpdatePictureRpc).not.toHaveBeenCalled();
  });

  it("clears the URL through the RPC and deletes the storage object when removing", async () => {
    const oldUrl = "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1.jpg";
    const setStudents = vi.fn();
    mockUseApp.mockReturnValue({
      currentUser: { id: "student-1", name: "Juan Dela Cruz", role: "student" },
      students: [student({ profilePictureUrl: oldUrl })],
      candidates: [],
      logs: [],
      setCurrentUser: vi.fn(),
      setStudents,
    });
    mockUpdatePictureRpc.mockResolvedValue({});
    mockDeletePictureRpc.mockResolvedValue(undefined);

    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: /Remove picture/ }));

    await waitFor(() => expect(mockUpdatePictureRpc).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(setStudents).toHaveBeenCalledWith([
        expect.objectContaining({ id: "student-1", profilePictureUrl: undefined }),
      ]),
    );
    // The now-unreferenced object is deleted — AFTER the RPC cleared
    // the column (the edge function refuses to delete a referenced one).
    await waitFor(() => expect(mockDeletePictureRpc).toHaveBeenCalledWith(oldUrl));
    expect(mockUpdatePictureRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeletePictureRpc.mock.invocationCallOrder[0],
    );
  });

  it("still clears the avatar when the storage delete fails", async () => {
    const oldUrl = "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1.jpg";
    const setStudents = vi.fn();
    mockUseApp.mockReturnValue({
      currentUser: { id: "student-1", name: "Juan Dela Cruz", role: "student" },
      students: [student({ profilePictureUrl: oldUrl })],
      candidates: [],
      logs: [],
      setCurrentUser: vi.fn(),
      setStudents,
    });
    mockUpdatePictureRpc.mockResolvedValue({});
    mockDeletePictureRpc.mockRejectedValue(new Error("storage down"));

    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: /Remove picture/ }));

    // Best-effort — the RPC already persisted the removal, so the
    // failed storage delete must not surface an error or undo it.
    await waitFor(() =>
      expect(setStudents).toHaveBeenCalledWith([
        expect.objectContaining({ id: "student-1", profilePictureUrl: undefined }),
      ]),
    );
    expect(screen.queryByText(/storage down/)).toBeNull();
    expect(screen.queryByText(/Could not remove the picture/)).toBeNull();
  });

  it("deletes the previous storage object when the picture is replaced", async () => {
    const oldUrl = "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1_old.jpg";
    stubContext([student({ profilePictureUrl: oldUrl })]);
    const url = "https://example.supabase.co/storage/v1/object/public/student-pictures/student_1_1.jpg";
    mockUploadStudentPicture.mockResolvedValue(url);
    mockUpdatePictureRpc.mockResolvedValue({});
    mockDeletePictureRpc.mockResolvedValue(undefined);

    const { container } = renderProfile();
    const pic = new File(["(oo)"], "me.png", { type: "image/png" });
    pickFile(container, pic);

    // Upload mints a new object; the old one is dropped only after
    // the RPC persisted the new URL.
    await waitFor(() => expect(mockDeletePictureRpc).toHaveBeenCalledWith(oldUrl));
    expect(mockUpdatePictureRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeletePictureRpc.mock.invocationCallOrder[0],
    );
  });
});
