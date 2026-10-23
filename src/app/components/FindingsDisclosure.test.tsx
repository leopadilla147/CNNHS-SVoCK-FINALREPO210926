import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FindingsDisclosure } from "./FindingsDisclosure";

describe("FindingsDisclosure", () => {
  it("reveals the findings as text when the Nature of Complaint is clicked — and hides them again", async () => {
    const user = userEvent.setup();
    render(
      <FindingsDisclosure
        id="f1"
        subject="Impersonation"
        decisionLabel="Substantiated Grievance"
        findings="CCTV matched a non-voter using another student's kiosk session."
      />,
    );

    // Findings stay hidden until the row is clicked — no dropdown, no files.
    expect(
      screen.queryByText("CCTV matched a non-voter using another student's kiosk session."),
    ).not.toBeInTheDocument();

    const row = screen.getByRole("button", { name: /Impersonation.*Substantiated Grievance/ });
    expect(row).toHaveAttribute("aria-expanded", "false");

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Findings")).toBeInTheDocument();
    expect(
      screen.getByText("CCTV matched a non-voter using another student's kiosk session."),
    ).toBeInTheDocument();

    await user.click(row);
    expect(
      screen.queryByText("CCTV matched a non-voter using another student's kiosk session."),
    ).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when no findings were recorded (pre-090 resolutions)", async () => {
    const user = userEvent.setup();
    render(<FindingsDisclosure id="f2" subject="Vote buying" findings={null} />);
    await user.click(screen.getByRole("button", { name: /Vote buying/ }));
    expect(screen.getByText("No findings recorded.")).toBeInTheDocument();
  });
});
