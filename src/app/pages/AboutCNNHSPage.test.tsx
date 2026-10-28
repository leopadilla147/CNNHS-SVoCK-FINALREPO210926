import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import AboutCNNHSPage from "./AboutCNNHSPage";

// Purely static public content — no context, no data fetch.

function renderPage() {
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
    expect(screen.getByText(/quality, equitable, culture-based, and complete basic education/)).toBeTruthy();
    expect(screen.getByText("Teachers facilitate learning and constantly nurture every learner.")).toBeTruthy();

    expect(screen.getByText("Our Core Values")).toBeTruthy();
    expect(screen.getByText("Maka-Diyos")).toBeTruthy();
    expect(screen.getByText("Love for God")).toBeTruthy();
    expect(screen.getByText("Maka-Tao")).toBeTruthy();
    expect(screen.getByText("Maka-Kalikasan")).toBeTruthy();
    expect(screen.getByText("Maka-Bansa")).toBeTruthy();
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
