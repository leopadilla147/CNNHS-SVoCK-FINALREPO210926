// LoginPage.test.tsx
// =============================================================
// RTL smoke over the REAL LoginPage component (TEST-02) inside the
// Plan 01 vitest harness (jsdom, globals, @ alias, vite.config
// env-fail-fast). The supabase client modules are mocked so the
// smoke never hits the network (T-04-04).
//
// Query strategy: LoginPage opens in role-select mode, rendering four
// role cards whose accessible names combine a role title and subtitle
// (e.g. "Student Voters & Candidates"). Clicking a card opens the login
// form for that role (email/password placeholders + a "Login" button).
// The form labels ("Email Address", "Password") are sibling labels
// WITHOUT htmlFor/id association, so getByLabelText cannot associate
// them - the smoke uses placeholder + role queries against the real
// markup.
// =============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import LoginPage from "./LoginPage";

const {
  mockSetCurrentUser,
  mockAddLog,
  mockNavigate,
  mockSignInStudentDirect,
} = vi.hoisted(() => ({
  mockSetCurrentUser: vi.fn(),
  mockAddLog: vi.fn(),
  mockNavigate: vi.fn(),
  mockSignInStudentDirect: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../context/AppContext", () => ({
  useApp: () => ({ setCurrentUser: mockSetCurrentUser, addLog: mockAddLog }),
}));

vi.mock("../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: true,
}));

vi.mock("../lib/supabaseData", () => ({
  signInWithSupabase: vi.fn(),
  signInStudentDirect: mockSignInStudentDirect,
  signInSslgAdviser: vi.fn(),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginPage (smoke)", () => {
  it("renders the role-select portal and the student login form", () => {
    renderPage();

    // Role-select portal cards come from the real component
    expect(screen.getByRole("button", { name: /Student Voters & Candidates/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Commissioner Review & Validate/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Admin System Control/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /SSLG Adviser Student Supervision/i })).toBeTruthy();

    // Open the student portal: email + password inputs and submit button
    fireEvent.click(screen.getByRole("button", { name: /Student Voters & Candidates/i }));
    expect(screen.getByPlaceholderText("Enter your email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Login" })).toBeTruthy();
  });

  it("submits student credentials through the real component and navigates", async () => {
    const studentUser = {
      id: "u1",
      name: "Student One",
      email: "student@cnnhs.edu",
      role: "student",
    };
    mockSignInStudentDirect.mockResolvedValue(studentUser);

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Student Voters & Candidates/i }));

    fireEvent.change(screen.getByPlaceholderText("Enter your email"), {
      target: { value: studentUser.email },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "supersecret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    // handleLogin has an 800ms UX delay before the mocked direct login
    await waitFor(
      () => expect(mockSignInStudentDirect).toHaveBeenCalledWith(studentUser.email, "supersecret1"),
      { timeout: 2000 },
    );

    expect(mockSetCurrentUser).toHaveBeenCalledWith(studentUser);
    expect(mockNavigate).toHaveBeenCalledWith("/student/dashboard");

    // Let the trailing state update (setLoading(false)) settle
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});