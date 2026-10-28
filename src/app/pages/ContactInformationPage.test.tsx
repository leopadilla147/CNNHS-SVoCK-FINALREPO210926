import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContactInformationPage from "./ContactInformationPage";

// The page fetches through supabaseData, so that module is stubbed — no
// provider, no Supabase (same pattern as PastElectionsPage-style tests).

const { mockFetchContacts } = vi.hoisted(() => ({
  mockFetchContacts: vi.fn(),
}));

vi.mock("../lib/supabaseData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/supabaseData")>();
  return { ...actual, fetchContactInformationRpc: mockFetchContacts };
});

const fullRoster = {
  chief_commissioner: { name: "Maria Santos", email: "chief@cnnhs.edu" },
  sslg_adviser: { name: "Juan Dela Cruz", email: "adviser@cnnhs.edu" },
  grievance_commissioner: { name: "Pedro Reyes", email: "grievance@cnnhs.edu" },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactInformationPage />
    </MemoryRouter>,
  );
}

describe("ContactInformationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists all three roles with a mailto email — no names are shown", async () => {
    mockFetchContacts.mockResolvedValue(fullRoster);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("chief@cnnhs.edu")).toBeTruthy();
    });

    expect(screen.getByText("Chief Commissioner")).toBeTruthy();
    expect(screen.getByText("SSLG Adviser")).toBeTruthy();
    expect(screen.getByText("Grievance Commissioner")).toBeTruthy();

    const mail = screen.getByText("chief@cnnhs.edu").closest("a") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe("mailto:chief@cnnhs.edu");
    // The roster carries names, but the page must not display them.
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(screen.queryByText("Juan Dela Cruz")).toBeNull();
    expect(screen.queryByText("Pedro Reyes")).toBeNull();
    expect(screen.getByText("adviser@cnnhs.edu")).toBeTruthy();
    expect(screen.getByText("grievance@cnnhs.edu")).toBeTruthy();
  });

  it("shows a vacancy notice for a role with no active officer", async () => {
    mockFetchContacts.mockResolvedValue({
      ...fullRoster,
      grievance_commissioner: null,
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("The position is currently vacant.")).toBeTruthy();
    });
    // Only one vacancy — the other two emails still render.
    expect(screen.getByText("chief@cnnhs.edu")).toBeTruthy();
    expect(screen.getByText("adviser@cnnhs.edu")).toBeTruthy();
    expect(screen.getAllByText("The position is currently vacant.").length).toBe(1);
  });

  it("shows the error state with a way back home when the RPC fails", async () => {
    mockFetchContacts.mockRejectedValue(new Error("RPC offline"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Unable to Load Contact Information")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Return Home" })).toBeTruthy();
  });
});
