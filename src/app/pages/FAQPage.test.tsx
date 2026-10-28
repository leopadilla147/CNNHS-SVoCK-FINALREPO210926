import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FAQPage from "./FAQPage";
import type { HomepageSettings } from "../context/AppContext";

// The page reads the settings through useApp, so it renders against a flat
// context stub — no provider, no Supabase.

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../context/AppContext", async (importOriginal) => {
  // Keep the real defaultHomepageSettings + formatOfficeTime; only the hook
  // is stubbed.
  const actual = await importOriginal<typeof import("../context/AppContext")>();
  return { ...actual, useApp: mockUseApp };
});

const settings: HomepageSettings = {
  contactEmail: "sslgoffice@cnnhs.edu.ph",
  location: "Camarines Norte National High School, Daet",
  officeHoursStart: "08:00",
  officeHoursEnd: "17:00",
};

function renderPage(overrides: Partial<HomepageSettings> = {}) {
  mockUseApp.mockReturnValue({ homepageSettings: { ...settings, ...overrides } });
  return render(<FAQPage />);
}

describe("FAQPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the hero and every shared question", () => {
    renderPage();

    expect(screen.getByText("Frequently Asked Questions")).toBeTruthy();
    expect(screen.getByText("How do I register as a voter?")).toBeTruthy();
    expect(screen.getByText("When are election results published?")).toBeTruthy();
    expect(screen.getByText("Can I change my vote?")).toBeTruthy();
  });

  it("filters the list through the search box and offers an empty state", () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Search FAQ"), { target: { value: "kiosk" } });
    expect(screen.getByText("How does biometric voting work?")).toBeTruthy();
    expect(screen.queryByText("How do I file a complaint?")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search FAQ"), { target: { value: "zzz-no-match" } });
    expect(screen.getByText("No matching questions")).toBeTruthy();
  });

  it("opens an answer on click and closes it on the second click", () => {
    renderPage();

    const question = screen.getByRole("button", { name: /How do I register as a voter\?/ });
    expect(screen.queryByText(/must match the Student Masterlist/)).toBeNull();

    fireEvent.click(question);
    expect(screen.getByText(/must match the Student Masterlist/)).toBeTruthy();

    fireEvent.click(question);
    expect(screen.queryByText(/must match the Student Masterlist/)).toBeNull();
  });

  it("shows the Need More Help card from the homepage settings", () => {
    renderPage();

    const mail = screen.getByText("sslgoffice@cnnhs.edu.ph").closest("a") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe("mailto:sslgoffice@cnnhs.edu.ph");
    const maps = screen.getByText("Camarines Norte National High School, Daet").closest("a") as HTMLAnchorElement;
    expect(maps.href).toContain("google.com/maps");
    expect(screen.getByText(/Office Hours: 8:00 AM - 5:00 PM/)).toBeTruthy();
  });
});
