import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import AboutCNNHSPage from "./AboutCNNHSPage";
import { defaultHomepageSettings } from "../context/AppContext";

// The page reads its content through useApp, so it renders against a flat
// context stub — no provider, no Supabase (same pattern as FAQPage.test).
const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../context/AppContext", async (importOriginal) => {
  // Keep the real defaultHomepageSettings; only the hook is stubbed.
  const actual = await importOriginal<typeof import("../context/AppContext")>();
  return { ...actual, useApp: mockUseApp };
});

function renderPage(overrides: Partial<typeof defaultHomepageSettings> = {}) {
  mockUseApp.mockReturnValue({
    homepageSettings: { ...defaultHomepageSettings, ...overrides },
  });
  return render(
    <MemoryRouter>
      <AboutCNNHSPage />
    </MemoryRouter>,
  );
}

describe("AboutCNNHSPage", () => {
  it("presents a brief school profile with the DepEd Vision, Mission, and Core Values", () => {
    renderPage();

    expect(screen.getByText("About CNNHS")).toBeTruthy();
    expect(screen.getByText("Camarines Norte National High School")).toBeTruthy();

    expect(screen.getByText("DepEd Vision")).toBeTruthy();
    expect(screen.getByText(/We dream of Filipinos/)).toBeTruthy();
    expect(screen.getByText(/learner-centered public institution/)).toBeTruthy();

    expect(screen.getByText("DepEd Mission")).toBeTruthy();
    expect(screen.getByText(/quality and equitable/)).toBeTruthy();
    expect(screen.getByText("Teachers facilitate learning to nurture every learner.")).toBeTruthy();

    expect(screen.getByText("Our Core Values")).toBeTruthy();
    expect(screen.getByText("Maka-Diyos")).toBeTruthy();
    expect(screen.getByText("Love for God")).toBeTruthy();
    expect(screen.getByText("Maka-Tao")).toBeTruthy();
    expect(screen.getByText("Maka-Kalikasan")).toBeTruthy();
    expect(screen.getByText("Maka-Bansa")).toBeTruthy();
  });

  it("renders the Chief's saved Homepage Setting content instead of the shipped wording", () => {
    renderPage({
      briefInfo: "Custom school profile from the settings row.",
      vision: "Custom vision statement.",
      mission: "Custom mission intro.\n• Custom bullet one.",
      coreValues: [{ title: "Custom Value", gloss: "Custom gloss" }],
    });

    expect(screen.getByText("Custom school profile from the settings row.")).toBeTruthy();
    expect(screen.getByText("Custom vision statement.")).toBeTruthy();
    expect(screen.getByText("Custom mission intro.")).toBeTruthy();
    expect(screen.getByText("Custom bullet one.")).toBeTruthy();
    expect(screen.getByText("Custom Value")).toBeTruthy();
    expect(screen.queryByText("Maka-Diyos")).toBeNull();
  });

  it("falls back to the shipped wording when a saved field is cleared", () => {
    renderPage({ briefInfo: "", vision: "", mission: "", coreValues: [] });

    expect(screen.getByText(/CNNHS is a public secondary school/)).toBeTruthy();
    expect(screen.getByText(/We dream of Filipinos/)).toBeTruthy();
    expect(screen.getByText("Teachers facilitate learning to nurture every learner.")).toBeTruthy();
    expect(screen.getByText("Maka-Diyos")).toBeTruthy();
  });

  it("carries no sections or quick links beyond the profile and DepEd statements", () => {
    renderPage();

    expect(screen.queryByText(/Supreme Student Learner Government \(SSLG\)/)).toBeNull();
    expect(screen.queryByText(/Online Voting and Election Management System/)).toBeNull();
    // "Take a Look Around" quick links are gone.
    expect(screen.queryByRole("link", { name: "Current Election" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Election Guidelines" })).toBeNull();
    expect(screen.queryByRole("link", { name: "FAQ" })).toBeNull();
  });
});
