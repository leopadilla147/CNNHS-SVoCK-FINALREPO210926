import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const { mockUseApp } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
}));

vi.mock("../../context/AppContext", () => ({
  useApp: mockUseApp,
}));

vi.mock("../../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

function renderHeader() {
  render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

// Desktop nav lives inside <header>; the mobile panel is its sibling, so
// scoping here keeps the two copies apart.
const desktop = () => within(document.querySelector("header") as HTMLElement);
/** Dropdown panels are only mounted while open. */
const panelLink = (name: RegExp) => desktop().queryByRole("link", { name });

describe("Header dropdowns", () => {
  beforeEach(() => {
    mockUseApp.mockReturnValue({ currentUser: null, setCurrentUser: vi.fn() });
  });

  it("closes the other menu when a second one is opened", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Voter Registration/ }));
    expect(panelLink(/Register to Vote/)).toBeTruthy();

    fireEvent.click(desktop().getByRole("button", { name: /Elections/ }));

    // Opening Elections must have closed Voter Registration.
    expect(panelLink(/Register to Vote/)).toBeNull();
    expect(panelLink(/Current Election/)).toBeTruthy();
  });

  it("closes the open menu when its own button is clicked again", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Elections/ }));
    expect(panelLink(/Current Election/)).toBeTruthy();

    fireEvent.click(desktop().getByRole("button", { name: /Elections/ }));
    expect(panelLink(/Current Election/)).toBeNull();
  });

  it("closes the open menu on outside click", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Elections/ }));
    expect(panelLink(/Current Election/)).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(panelLink(/Current Election/)).toBeNull();
  });

  it("closes the open menu on Escape", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Elections/ }));
    expect(panelLink(/Current Election/)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(panelLink(/Current Election/)).toBeNull();
  });
});

describe("Header mobile menu", () => {
  beforeEach(() => {
    mockUseApp.mockReturnValue({ currentUser: null, setCurrentUser: vi.fn() });
  });

  it("starts closed and toggles via the hamburger button", () => {
    renderHeader();

    const toggle = screen.getByRole("button", { name: "Toggle navigation menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("mobile-nav")?.className).toContain("hidden");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("mobile-nav")?.className).toContain("block");
  });
});
