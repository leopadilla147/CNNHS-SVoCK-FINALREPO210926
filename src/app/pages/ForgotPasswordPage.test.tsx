// ForgotPasswordPage.test.tsx
// =============================================================
// RTL smoke over the REAL ForgotPasswordPage component (email-OTP reset,
// migration 120 + send_password_reset edge function), mirroring the
// LoginPage.test.tsx harness: jsdom, mocked lib modules, no network.
//
// The page has three internal states driven by step: "email" -> "code" ->
// "done".  The smoke walks the happy path and asserts the client-side
// validation guards, using placeholder + role queries (labels have no
// htmlFor association, same as LoginPage).
// =============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ForgotPasswordPage from "./ForgotPasswordPage";

const { mockNavigate, mockRequestCode, mockResetWithCode } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRequestCode: vi.fn(),
  mockResetWithCode: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: true,
}));

vi.mock("../lib/supabaseData", () => ({
  requestPasswordResetCode: mockRequestCode,
  resetPasswordWithCode: mockResetWithCode,
}));

function renderPage() {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForgotPasswordPage (smoke)", () => {
  it("renders the email step and sends a code for a valid email", async () => {
    mockRequestCode.mockResolvedValue(undefined);

    renderPage();
    expect(screen.getByText("Forgot Password")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your email")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Enter your email"), {
      target: { value: "student@cnnhs.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));

    await waitFor(() => expect(mockRequestCode).toHaveBeenCalledWith("student@cnnhs.edu"));

    // Step advances to the code entry form.
    expect(screen.getByPlaceholderText("8-character code")).toBeTruthy();
    expect(screen.getByPlaceholderText("At least 8 characters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Password" })).toBeTruthy();
  });

  it("rejects an invalid email without calling the edge function", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Enter your email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));

    expect(mockRequestCode).not.toHaveBeenCalled();
    expect(screen.getByText(/Please enter a valid email address/i)).toBeTruthy();
  });

  it("guards the code step: short password and mismatch never reach the RPC", async () => {
    mockRequestCode.mockResolvedValue(undefined);

    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Enter your email"), {
      target: { value: "student@cnnhs.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));
    await waitFor(() => expect(screen.getByPlaceholderText("8-character code")).toBeTruthy());

    // Missing code
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "longenough1" } });
    fireEvent.change(screen.getByPlaceholderText("Re-enter the new password"), { target: { value: "longenough1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(screen.getByText("Please enter the code from your email.")).toBeTruthy();

    // Short password
    fireEvent.change(screen.getByPlaceholderText("8-character code"), { target: { value: "ABCD2345" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "short1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(screen.getByText(/at least 8 characters/i)).toBeTruthy();

    // Mismatch
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "longenough1" } });
    fireEvent.change(screen.getByPlaceholderText("Re-enter the new password"), { target: { value: "different99" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(screen.getByText(/do not match/i)).toBeTruthy();

    expect(mockResetWithCode).not.toHaveBeenCalled();
  });

  it("submits code + new password and shows the success screen", async () => {
    mockRequestCode.mockResolvedValue(undefined);
    mockResetWithCode.mockResolvedValue(undefined);

    renderPage();
    fireEvent.change(screen.getByPlaceholderText("Enter your email"), {
      target: { value: "student@cnnhs.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Code" }));
    await waitFor(() => expect(screen.getByPlaceholderText("8-character code")).toBeTruthy());

    // The input uppercases what the user typed.
    fireEvent.change(screen.getByPlaceholderText("8-character code"), { target: { value: "abcd2345" } });
    expect((screen.getByPlaceholderText("8-character code") as HTMLInputElement).value).toBe("ABCD2345");

    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByPlaceholderText("Re-enter the new password"), { target: { value: "newpassword1" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));

    await waitFor(() => expect(mockResetWithCode).toHaveBeenCalledWith("student@cnnhs.edu", "ABCD2345", "newpassword1"));

    expect(screen.getByText("Password reset successfully")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Login" }));
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
