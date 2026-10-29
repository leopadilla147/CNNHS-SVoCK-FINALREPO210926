import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminHomepageSettings from "./AdminHomepageSettings";
import type { CurrentUser, HomepageSettings } from "../../context/AppContext";
import { defaultHomepageSettings } from "../../context/AppContext";

// The page reads everything through useApp, so it renders against a flat
// context stub — no provider, no Supabase (same pattern as
// AdminProfile.test.tsx).

const {
  mockConfirm,
  mockUploadGuidelines,
  mockSaveSettingsRpc,
  mockUseApp,
} = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockUploadGuidelines: vi.fn(),
  mockSaveSettingsRpc: vi.fn(),
  mockUseApp: vi.fn(),
}));

vi.mock("../../lib/useConfirm", () => ({
  useConfirm: () => ({ confirm: mockConfirm, dialog: null }),
}));

vi.mock("../../lib/supabaseData", () => ({
  uploadGuidelinesFile: mockUploadGuidelines,
  saveHomepageSettingsRpc: mockSaveSettingsRpc,
}));

vi.mock("../../context/AppContext", async (importOriginal) => {
  // Keep the real formatOfficeTime helper; only the hook is stubbed.
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: mockUseApp };
});

const shippedSettings: HomepageSettings = {
  ...defaultHomepageSettings,
  contactEmail: "voting@cnnhs.edu.ph",
  location: "Camarines Norte National High School, Daet, Camarines Norte, Philippines",
  officeHoursStart: "08:00",
  officeHoursEnd: "17:00",
};

function chief(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "admin-1",
    name: "Maria Santos",
    role: "admin",
    email: "maria@cnnhs.edu",
    commissionerRole: "chief",
    mustChangePassword: false,
    ...overrides,
  };
}

function stubContext(user: CurrentUser, settings: HomepageSettings = shippedSettings) {
  const setHomepageSettings = vi.fn();
  mockUseApp.mockReturnValue({
    currentUser: user,
    homepageSettings: settings,
    setHomepageSettings,
    addLog: vi.fn(),
  });
  return { setHomepageSettings };
}

function renderSettings() {
  return render(<AdminHomepageSettings />);
}

/** The upload button drives a hidden file input; go straight to it. */
function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AdminHomepageSettings — access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it("shows all three sections to the Chief Commissioner", () => {
    stubContext(chief());
    renderSettings();

    expect(screen.getByText("Election Guidelines")).toBeTruthy();
    expect(screen.getByText("Contact Us")).toBeTruthy();
    expect(screen.getByText("About CNNHS")).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(shippedSettings.contactEmail);
    expect(screen.getByLabelText("Office hours opening time")).toBeTruthy();
    expect(screen.getByLabelText("Office hours closing time")).toBeTruthy();
    expect((screen.getByLabelText("Brief Information") as HTMLTextAreaElement).value).toBe(shippedSettings.briefInfo);
    expect((screen.getByLabelText("Vision") as HTMLTextAreaElement).value).toBe(shippedSettings.vision);
    expect((screen.getByLabelText("Mission") as HTMLTextAreaElement).value).toBe(shippedSettings.mission);
    expect((screen.getByLabelText("Core value 1 title") as HTMLInputElement).value).toBe("Maka-Diyos");
  });

  it("refuses a commissioner who is not the Chief", () => {
    stubContext(chief({ commissionerRole: "electoral_board" }));
    renderSettings();

    expect(screen.getByText(/Only the Chief Commissioner/)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

describe("AdminHomepageSettings — Contact Us", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it("saves the edited contact details through the RPC and updates the context", async () => {
    const { setHomepageSettings } = stubContext(chief());
    mockSaveSettingsRpc.mockResolvedValue({
      ...shippedSettings,
      contactEmail: "sslgoffice@cnnhs.edu.ph",
      officeHoursStart: "07:30",
    });
    renderSettings();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "sslgoffice@cnnhs.edu.ph" },
    });
    fireEvent.change(screen.getByLabelText("Office hours opening time"), {
      target: { value: "07:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Contact Us/ }));

    await waitFor(() => {
      expect(mockSaveSettingsRpc).toHaveBeenCalledWith({
        guidelinesUrl: null,
        guidelinesName: null,
        contactEmail: "sslgoffice@cnnhs.edu.ph",
        location: shippedSettings.location,
        officeHoursStart: "07:30",
        officeHoursEnd: "17:00",
        briefInfo: shippedSettings.briefInfo,
        vision: shippedSettings.vision,
        mission: shippedSettings.mission,
        coreValues: shippedSettings.coreValues,
      });
    });
    await waitFor(() => {
      expect(setHomepageSettings).toHaveBeenCalledWith(
        expect.objectContaining({ contactEmail: "sslgoffice@cnnhs.edu.ph" }),
      );
    });
  });

  it("carries the uploaded guidelines file through a contact-only save", async () => {
    const uploaded: HomepageSettings = {
      ...shippedSettings,
      guidelinesUrl: "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_1.pdf",
      guidelinesName: "Guidelines 2026.pdf",
    };
    stubContext(chief(), uploaded);
    mockSaveSettingsRpc.mockResolvedValue(uploaded);
    renderSettings();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "sslgoffice@cnnhs.edu.ph" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Contact Us/ }));

    await waitFor(() => {
      expect(mockSaveSettingsRpc).toHaveBeenCalledWith(
        expect.objectContaining({
          guidelinesUrl: uploaded.guidelinesUrl,
          guidelinesName: "Guidelines 2026.pdf",
        }),
      );
    });
  });

  it("blocks the save and keeps the RPC untouched on an invalid email", async () => {
    stubContext(chief());
    renderSettings();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Contact Us/ }));

    await waitFor(() => {
      expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    });
    expect(mockSaveSettingsRpc).not.toHaveBeenCalled();
  });

  it("blocks a closing time that is not after the opening time", async () => {
    stubContext(chief());
    renderSettings();

    fireEvent.change(screen.getByLabelText("Office hours closing time"), {
      target: { value: "07:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Contact Us/ }));

    await waitFor(() => {
      expect(screen.getByText("The office closing time must be after the opening time.")).toBeTruthy();
    });
    expect(mockSaveSettingsRpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's error message when the save is refused", async () => {
    stubContext(chief());
    mockSaveSettingsRpc.mockRejectedValue(new Error("Only the Chief Commissioner can manage officers."));
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /Save Contact Us/ }));

    await waitFor(() => {
      expect(screen.getByText(/Only the Chief Commissioner/)).toBeTruthy();
    });
  });
});

describe("AdminHomepageSettings — Election Guidelines file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it("shows the uploaded file with an open link when one is set", () => {
    const uploaded: HomepageSettings = {
      ...shippedSettings,
      guidelinesUrl: "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_1.pdf",
      guidelinesName: "Guidelines 2026.pdf",
    };
    stubContext(chief(), uploaded);
    renderSettings();

    expect(screen.getByText("Guidelines 2026.pdf")).toBeTruthy();
    const link = screen.getByText(/Open current file/).closest("a") as HTMLAnchorElement;
    expect(link.href).toBe(uploaded.guidelinesUrl);
    expect(screen.getByRole("button", { name: /Replace File/ })).toBeTruthy();
  });

  it("uploads a picked PDF, then persists the returned URL through the RPC", async () => {
    const { setHomepageSettings } = stubContext(chief());
    const url = "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_1_Guidelines_2026.pdf";
    mockUploadGuidelines.mockResolvedValue(url);
    mockSaveSettingsRpc.mockResolvedValue({ ...shippedSettings, guidelinesUrl: url, guidelinesName: "Guidelines 2026.pdf" });
    const { container } = renderSettings();

    pickFile(container, new File(["x"], "Guidelines 2026.pdf", { type: "application/pdf" }));

    await waitFor(() => {
      expect(mockUploadGuidelines).toHaveBeenCalledWith(expect.objectContaining({ name: "Guidelines 2026.pdf" }));
    });
    await waitFor(() => {
      expect(mockSaveSettingsRpc).toHaveBeenCalledWith(
        expect.objectContaining({ guidelinesUrl: url, guidelinesName: "Guidelines 2026.pdf" }),
      );
    });
    await waitFor(() => {
      expect(setHomepageSettings).toHaveBeenCalledWith(
        expect.objectContaining({ guidelinesUrl: url }),
      );
    });
  });

  it("refuses a file that is not PDF, DOC, or DOCX", async () => {
    stubContext(chief());
    const { container } = renderSettings();

    pickFile(container, new File(["x"], "photo.jpg", { type: "image/jpeg" }));

    await waitFor(() => {
      expect(screen.getByText("Only PDF, DOC, or DOCX files are allowed.")).toBeTruthy();
    });
    expect(mockUploadGuidelines).not.toHaveBeenCalled();
  });

  it("removes the file through the RPC", async () => {
    const uploaded: HomepageSettings = {
      ...shippedSettings,
      guidelinesUrl: "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_1.pdf",
      guidelinesName: "Guidelines 2026.pdf",
    };
    const { setHomepageSettings } = stubContext(chief(), uploaded);
    mockSaveSettingsRpc.mockResolvedValue(shippedSettings);
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockSaveSettingsRpc).toHaveBeenCalledWith(
        expect.objectContaining({ guidelinesUrl: null, guidelinesName: null }),
      );
    });
    await waitFor(() => {
      expect(setHomepageSettings).toHaveBeenCalledWith(shippedSettings);
    });
  });
});

describe("AdminHomepageSettings — About CNNHS content (119)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  it("saves the edited About content through the RPC and updates the context", async () => {
    const { setHomepageSettings } = stubContext(chief());
    mockSaveSettingsRpc.mockResolvedValue({
      ...shippedSettings,
      briefInfo: "Updated school profile.",
    });
    renderSettings();

    fireEvent.change(screen.getByLabelText("Brief Information"), {
      target: { value: "Updated school profile." },
    });
    fireEvent.change(screen.getByLabelText("Core value 1 title"), {
      target: { value: "Maka-Diyos at Maka-Tao" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save About CNNHS/ }));

    await waitFor(() => {
      expect(mockSaveSettingsRpc).toHaveBeenCalledWith({
        guidelinesUrl: null,
        guidelinesName: null,
        contactEmail: shippedSettings.contactEmail,
        location: shippedSettings.location,
        officeHoursStart: shippedSettings.officeHoursStart,
        officeHoursEnd: shippedSettings.officeHoursEnd,
        briefInfo: "Updated school profile.",
        vision: shippedSettings.vision,
        mission: shippedSettings.mission,
        coreValues: [
          { title: "Maka-Diyos at Maka-Tao", gloss: "Love for God" },
          { title: "Maka-Tao", gloss: "Love for Fellowmen" },
          { title: "Maka-Kalikasan", gloss: "Love for Nature" },
          { title: "Maka-Bansa", gloss: "Love for Country" },
        ],
      });
    });
    await waitFor(() => {
      expect(setHomepageSettings).toHaveBeenCalledWith(
        expect.objectContaining({ briefInfo: "Updated school profile." }),
      );
    });
  });

  it("adds and removes core value rows", () => {
    stubContext(chief());
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /Add Core Value/ }));
    expect((screen.getByLabelText("Core value 5 title") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Remove core value 1" }));
    expect(screen.queryByLabelText("Core value 5 title")).toBeNull();
    // the rows shift up — the added blank row is now the last one
    expect((screen.getByLabelText("Core value 1 title") as HTMLInputElement).value).toBe("Maka-Tao");
    expect((screen.getByLabelText("Core value 4 title") as HTMLInputElement).value).toBe("");
  });

  it("blocks the save when a core value row has no title", async () => {
    stubContext(chief());
    renderSettings();

    fireEvent.change(screen.getByLabelText("Core value 1 title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save About CNNHS/ }));

    await waitFor(() => {
      expect(screen.getByText("Every core value needs a title.")).toBeTruthy();
    });
    expect(mockSaveSettingsRpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's error message when the About save is refused", async () => {
    stubContext(chief());
    mockSaveSettingsRpc.mockRejectedValue(new Error("Only the Chief Commissioner can manage officers."));
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /Save About CNNHS/ }));

    await waitFor(() => {
      expect(screen.getByText(/Only the Chief Commissioner/)).toBeTruthy();
    });
  });
});
