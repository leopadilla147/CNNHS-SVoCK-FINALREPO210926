import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminProfile from "./AdminProfile";
import type { CurrentUser } from "../../context/AppContext";

// The page reads everything through useApp, so it renders against a flat
// context stub — no provider, no Supabase (same pattern as
// StudentProfile.test.tsx).

const { mockConfirm, mockUploadAdminPicture, mockUpdatePictureRpc, mockDeletePictureRpc, mockUseApp } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockUploadAdminPicture: vi.fn(),
  mockUpdatePictureRpc: vi.fn(),
  mockDeletePictureRpc: vi.fn(),
  mockUseApp: vi.fn(),
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../lib/supabaseData", () => ({
  updateAdminPassword: vi.fn(),
  uploadAdminPicture: mockUploadAdminPicture,
  updateMyAdminPictureRpc: mockUpdatePictureRpc,
  deleteAdminPictureRpc: mockDeletePictureRpc,
}));

vi.mock("../../context/AppContext", () => ({
  useApp: mockUseApp,
}));

const PICTURE_URL =
  "https://example.supabase.co/storage/v1/object/public/admin-pictures/admin_1_1000.jpg";

function admin(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "admin-1",
    name: "Maria Santos",
    role: "admin",
    email: "maria@cnnhs.edu",
    commissionerRole: "electoral_board",
    mustChangePassword: false,
    ...overrides,
  };
}

function stubContext(user: CurrentUser) {
  const setCurrentUser = vi.fn();
  mockUseApp.mockReturnValue({ currentUser: user, addLog: vi.fn(), setCurrentUser });
  return { setCurrentUser };
}

function renderProfile() {
  return render(<AdminProfile />);
}

/** The camera button drives a hidden file input; go straight to it. */
function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AdminProfile picture avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    stubContext(admin());
  });

  it("renders the initial when no picture is set", () => {
    const { container } = renderProfile();

    expect(screen.getByText("M")).toBeTruthy();
    expect(container.querySelector('img[alt="Maria Santos"]')).toBeNull();
  });

  it("renders the stored photo instead of the initial when one is set", () => {
    stubContext(admin({ profilePictureUrl: PICTURE_URL }));
    const { container } = renderProfile();

    const img = container.querySelector('img[alt="Maria Santos"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("admin-pictures");
    expect(screen.queryByText("M")).toBeNull();
  });

  it("offers a remove button only when a picture is set", () => {
    const { rerender } = renderProfile();
    expect(screen.queryByRole("button", { name: /Remove picture/ })).toBeNull();

    stubContext(admin({ profilePictureUrl: PICTURE_URL }));
    rerender(<AdminProfile />);

    expect(screen.getByRole("button", { name: /Remove picture/ })).toBeTruthy();
  });

  it("rejects an image larger than the 2 MB bucket limit", async () => {
    const { container } = renderProfile();
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });

    pickFile(container, big);

    await waitFor(() => expect(screen.getByText("Image must be 2 MB or smaller.")).toBeInTheDocument());
    expect(mockUploadAdminPicture).not.toHaveBeenCalled();
  });

  it("rejects a non-image file", async () => {
    const { container } = renderProfile();
    const doc = new File(["hello"], "notes.pdf", { type: "application/pdf" });

    pickFile(container, doc);

    await waitFor(() =>
      expect(screen.getByText("Only JPEG, PNG, or WebP images are allowed.")).toBeInTheDocument(),
    );
    expect(mockUploadAdminPicture).not.toHaveBeenCalled();
  });

  it("uploads, persists via the RPC and refreshes currentUser on confirm", async () => {
    const { setCurrentUser } = stubContext(admin());
    mockUploadAdminPicture.mockResolvedValue(PICTURE_URL);
    mockUpdatePictureRpc.mockResolvedValue({});

    const { container } = renderProfile();
    const pic = new File(["(oo)"], "me.png", { type: "image/png" });
    pickFile(container, pic);

    await waitFor(() => expect(mockUploadAdminPicture).toHaveBeenCalledWith("admin-1", pic));
    await waitFor(() => expect(mockUpdatePictureRpc).toHaveBeenCalledWith(PICTURE_URL));
    await waitFor(() =>
      expect(setCurrentUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "admin-1", profilePictureUrl: PICTURE_URL }),
      ),
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
    expect(mockUploadAdminPicture).not.toHaveBeenCalled();
    expect(mockUpdatePictureRpc).not.toHaveBeenCalled();
  });

  it("clears the URL through the RPC and deletes the storage object when removing", async () => {
    const { setCurrentUser } = stubContext(admin({ profilePictureUrl: PICTURE_URL }));
    mockUpdatePictureRpc.mockResolvedValue({});
    mockDeletePictureRpc.mockResolvedValue(undefined);

    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: /Remove picture/ }));

    await waitFor(() => expect(mockUpdatePictureRpc).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(setCurrentUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "admin-1", profilePictureUrl: undefined }),
      ),
    );
    // The now-unreferenced object is deleted — AFTER the RPC cleared the
    // column (the edge function refuses to delete a referenced one).
    await waitFor(() => expect(mockDeletePictureRpc).toHaveBeenCalledWith(PICTURE_URL));
    expect(mockUpdatePictureRpc.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeletePictureRpc.mock.invocationCallOrder[0],
    );
  });

  it("still clears the avatar when the storage delete fails", async () => {
    const { setCurrentUser } = stubContext(admin({ profilePictureUrl: PICTURE_URL }));
    mockUpdatePictureRpc.mockResolvedValue({});
    mockDeletePictureRpc.mockRejectedValue(new Error("storage down"));

    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: /Remove picture/ }));

    await waitFor(() =>
      expect(setCurrentUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: "admin-1", profilePictureUrl: undefined }),
      ),
    );
    expect(screen.queryByText(/storage down/)).toBeNull();
    expect(screen.queryByText(/Could not remove the picture/)).toBeNull();
  });
});

describe("AdminProfile role labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it("labels the SSLG Adviser instead of Administrator", () => {
    stubContext(admin({ role: "sslg_adviser", commissionerRole: undefined }));

    renderProfile();

    // Header subtitle + Role row both carry the label.
    expect(screen.getAllByText("SSLG Adviser")).toHaveLength(2);
    expect(screen.queryByText("Administrator")).toBeNull();
  });

  it("keeps the Administrator label for an admin without a commissioner role", () => {
    stubContext(admin({ commissionerRole: undefined }));

    renderProfile();

    expect(screen.getAllByText("Administrator")).toHaveLength(2);
    expect(screen.queryByText("SSLG Adviser")).toBeNull();
  });
});
