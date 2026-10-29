import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GuidelinesPage from "./GuidelinesPage";
import type { HomepageSettings } from "../context/AppContext";
import { defaultHomepageSettings } from "../context/AppContext";

// The page reads the settings through useApp, so it renders against a flat
// context stub — no provider, no Supabase.

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../context/AppContext", async (importOriginal) => {
  // Keep the real defaultHomepageSettings; only the hook is stubbed.
  const actual = await importOriginal<typeof import("../context/AppContext")>();
  return { ...actual, useApp: mockUseApp };
});

const shipped: HomepageSettings = {
  ...defaultHomepageSettings,
  contactEmail: "voting@cnnhs.edu.ph",
  location: "Camarines Norte National High School, Daet, Camarines Norte, Philippines",
  officeHoursStart: "08:00",
  officeHoursEnd: "17:00",
};

const PDF_URL =
  "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_1_Guidelines_2026.pdf";
const DOC_URL =
  "https://example.supabase.co/storage/v1/object/public/homepage-files/guidelines_2_Guidelines.docx";

function renderPage(settings: Partial<HomepageSettings> = {}) {
  mockUseApp.mockReturnValue({ homepageSettings: { ...shipped, ...settings } });
  return render(
    <MemoryRouter>
      <GuidelinesPage />
    </MemoryRouter>,
  );
}

describe("GuidelinesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the title with the new description and the empty state when no file is posted", () => {
    renderPage();

    expect(screen.getByText("Election Guidelines")).toBeTruthy();
    expect(
      screen.getByText(/official guidelines for implementing the Learner Government Program \(LGP\)/),
    ).toBeTruthy();
    expect(screen.getByText("No Guidelines Posted Yet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open Guidelines/ })).toBeNull();
  });

  it("shows the uploaded PDF with an open link and an inline preview", () => {
    const { container } = renderPage({
      guidelinesUrl: PDF_URL,
      guidelinesName: "Guidelines 2026.pdf",
    });

    expect(screen.getByText("Guidelines 2026.pdf")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Open Guidelines/ }) as HTMLAnchorElement;
    expect(link.href).toBe(PDF_URL);
    expect(link.target).toBe("_blank");
    const frame = container.querySelector('iframe[title="Election Guidelines document preview"]') as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.src).toBe(PDF_URL);
  });

  it("skips the inline preview for non-PDF documents", () => {
    const { container } = renderPage({
      guidelinesUrl: DOC_URL,
      guidelinesName: "Guidelines.docx",
    });

    expect(screen.getByRole("link", { name: /Open Guidelines/ })).toBeTruthy();
    expect(container.querySelector('iframe[title="Election Guidelines document preview"]')).toBeNull();
  });
});
