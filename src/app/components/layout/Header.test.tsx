import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";

const { mockUseApp, mockNavigate } = vi.hoisted(() => ({
  mockUseApp: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("../../context/AppContext", () => ({
  useApp: mockUseApp,
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

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
const panelLink = (name: RegExp | string) => desktop().queryByRole("link", { name });

describe("Header dropdowns", () => {
  beforeEach(() => {
    mockUseApp.mockReturnValue({ currentUser: null, setCurrentUser: vi.fn() });
  });

  it("closes the other menu when a second one is opened", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Results/ }));
    expect(panelLink(/Official Results/)).toBeTruthy();

    fireEvent.click(desktop().getByRole("button", { name: /Resources/ }));

    // Opening Resources must have closed Results.
    expect(panelLink(/Official Results/)).toBeNull();
    expect(panelLink(/Election Calendar/)).toBeTruthy();
  });

  it("shows Student Registration and Current Election as direct tabs, not dropdowns", () => {
    renderHeader();

    expect(desktop().getByRole("link", { name: "Student Registration" })).toBeTruthy();
    expect(desktop().getByRole("link", { name: "Current Election" })).toBeTruthy();
  });

  it("closes the open menu when its own button is clicked again", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Results/ }));
    expect(panelLink(/Official Results/)).toBeTruthy();

    fireEvent.click(desktop().getByRole("button", { name: /Results/ }));
    expect(panelLink(/Official Results/)).toBeNull();
  });

  it("closes the open menu on outside click", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Results/ }));
    expect(panelLink(/Official Results/)).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(panelLink(/Official Results/)).toBeNull();
  });

  it("closes the open menu on Escape", () => {
    renderHeader();

    fireEvent.click(desktop().getByRole("button", { name: /Results/ }));
    expect(panelLink(/Official Results/)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(panelLink(/Official Results/)).toBeNull();
  });
});

describe("Header nav visibility", () => {
  beforeEach(() => {
    mockUseApp.mockReturnValue({ currentUser: null, setCurrentUser: vi.fn() });
  });

  it("shows Student Registration to guests", () => {
    renderHeader();

    expect(desktop().getByRole("link", { name: "Student Registration" })).toBeTruthy();
  });

  it("hides Student Registration once any user is signed in", () => {
    mockUseApp.mockReturnValue({
      currentUser: {
        id: "s1",
        name: "Ana Reyes",
        role: "student" as const,
        email: "ana@cnnhs.edu",
        mustChangePassword: false,
      },
      setCurrentUser: vi.fn(),
    });
    renderHeader();

    expect(desktop().queryByRole("link", { name: "Student Registration" })).toBeNull();
    expect(desktop().getByRole("link", { name: "Current Election" })).toBeTruthy();
    expect(desktop().getByRole("link", { name: "About CNNHS" })).toBeTruthy();
  });
});

describe("Header avatar", () => {
  const staffUser = {
    id: "admin-1",
    name: "Maria Santos",
    role: "admin" as const,
    email: "maria@cnnhs.edu",
    commissionerRole: "electoral_board" as const,
    mustChangePassword: false,
  };

  const userButton = () => desktop().getByRole("button", { name: /Maria Santos/ });

  it("shows a staff photo instead of the initial when one is set", () => {
    mockUseApp.mockReturnValue({
      currentUser: {
        ...staffUser,
        profilePictureUrl:
          "https://example.supabase.co/storage/v1/object/public/admin-pictures/admin_1_1000.jpg",
      },
      setCurrentUser: vi.fn(),
    });

    renderHeader();

    expect(userButton().querySelector('img[src*="admin-pictures"]')).toBeTruthy();
  });

  it("falls back to the initial when no photo is set", () => {
    mockUseApp.mockReturnValue({ currentUser: staffUser, setCurrentUser: vi.fn() });

    renderHeader();

    expect(userButton().querySelector("img")).toBeNull();
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

describe("Header user dropdown", () => {
  const electoralUser = {
    id: "admin-1",
    name: "Maria Santos",
    role: "admin" as const,
    email: "maria@cnnhs.edu",
    commissionerRole: "electoral_board" as const,
    mustChangePassword: false,
  };

  const openUserDropdown = (name: RegExp) => {
    renderHeader();
    fireEvent.click(desktop().getByRole("button", { name }));
  };

  it("shows the Electoral Board tabs plus My Profile and Logout", () => {
    mockUseApp.mockReturnValue({ currentUser: electoralUser, setCurrentUser: vi.fn() });
    openUserDropdown(/Maria Santos/);

    expect(panelLink("Dashboard")).toBeTruthy();
    expect(panelLink("Election Setup")).toBeTruthy();
    expect(panelLink("Live Results")).toBeTruthy();
    expect(panelLink("My Profile")).toBeTruthy();
    expect(desktop().getByRole("button", { name: /Logout/ })).toBeTruthy();

    // Other boards' tabs stay out of the dropdown.
    expect(panelLink(/Complaints/)).toBeNull();
    expect(panelLink(/Officer Management/)).toBeNull();
    expect(panelLink(/Candidates Review/)).toBeNull();
    // The profile page is the "My Profile" entry, not a duplicated tab.
    expect(panelLink("Admin Profile")).toBeNull();
  });

  it("shows the name and role title above the tabs", () => {
    mockUseApp.mockReturnValue({ currentUser: electoralUser, setCurrentUser: vi.fn() });
    openUserDropdown(/Maria Santos/);

    // The name shows in the trigger button and the identity block.
    expect(desktop().getAllByText("Maria Santos").length).toBeGreaterThan(0);
    expect(desktop().getByText("Commissioner of Electoral Board")).toBeTruthy();
  });

  it("titles a co-commissioner after their primary board", () => {
    mockUseApp.mockReturnValue({
      currentUser: { ...electoralUser, isCoCommissioner: true },
      setCurrentUser: vi.fn(),
    });
    openUserDropdown(/Maria Santos/);

    expect(desktop().getByText("Co-commissioner of Electoral Board")).toBeTruthy();
  });

  it("shows the student tabs, hiding View Candidates until there is a candidacy", () => {
    mockUseApp.mockReturnValue({
      currentUser: {
        id: "s1",
        name: "Ana Reyes",
        role: "student" as const,
        email: "ana@cnnhs.edu",
        mustChangePassword: false,
      },
      candidates: [],
      electionPeriod: { officialListPosted: false },
      setCurrentUser: vi.fn(),
    });
    openUserDropdown(/Ana Reyes/);

    expect(desktop().getAllByText("Ana Reyes").length).toBeGreaterThan(0);
    expect(desktop().getByText("Student")).toBeTruthy();
    expect(panelLink("Dashboard")).toBeTruthy();
    expect(panelLink("Apply for Candidacy")).toBeTruthy();
    expect(panelLink("My Complaints")).toBeTruthy();
    expect(panelLink("My Profile")).toBeTruthy();
    expect(panelLink("View Candidates")).toBeNull();
  });

  it("shows View Candidates once the official list is posted", () => {
    mockUseApp.mockReturnValue({
      currentUser: {
        id: "s1",
        name: "Ana Reyes",
        role: "student" as const,
        email: "ana@cnnhs.edu",
        mustChangePassword: false,
      },
      candidates: [],
      electionPeriod: { officialListPosted: true },
      setCurrentUser: vi.fn(),
    });
    openUserDropdown(/Ana Reyes/);

    expect(panelLink("View Candidates")).toBeTruthy();
  });

  it("asks for confirmation and keeps the user signed in when cancelled", () => {
    const setCurrentUser = vi.fn();
    mockUseApp.mockReturnValue({ currentUser: electoralUser, setCurrentUser });
    openUserDropdown(/Maria Santos/);

    fireEvent.click(desktop().getByRole("button", { name: /Logout/ }));

    // The confirm dialog portals to the body, outside <header>.
    expect(screen.getByText("Are you sure you want to logout of the voting system?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(setCurrentUser).not.toHaveBeenCalled();
    expect(screen.queryByText("Are you sure you want to logout of the voting system?")).toBeNull();
  });

  it("logs out only after the confirmation is accepted", async () => {
    const setCurrentUser = vi.fn();
    mockUseApp.mockReturnValue({ currentUser: electoralUser, setCurrentUser });
    openUserDropdown(/Maria Santos/);

    fireEvent.click(desktop().getByRole("button", { name: /Logout/ }));

    // The dialog's confirm button is also labelled "Logout" — take the one
    // from the portaled dialog (it renders after the header in the DOM).
    const dialogLogout = screen.getAllByRole("button", { name: "Logout" }).pop() as HTMLElement;
    fireEvent.click(dialogLogout);

    await waitFor(() => expect(setCurrentUser).toHaveBeenCalledWith(null));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
