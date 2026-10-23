import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ComplaintRecordSection } from "./ComplaintRecordSection";
import type { ElectionComplaintRecord } from "../lib/supabaseData";

const entries: ElectionComplaintRecord[] = [
  {
    id: "c1",
    subject: "Vote buying",
    status: "accepted",
    decision: "substantiated",
    findings: "Ballot receipts confirmed a proxy vote.",
  },
  {
    id: "c2",
    subject: "Late posting of results",
    status: "accepted",
    decision: "unsubstantiated",
  },
  {
    id: "c3",
    subject: "Campaigning inside the precinct",
    status: "filed",
  },
];

describe("ComplaintRecordSection", () => {
  it("renders nothing for an election with no complaint record", () => {
    const { container } = render(<ComplaintRecordSection entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows substantiated grievances with click-to-reveal findings and the other decisions", async () => {
    const user = userEvent.setup();
    render(
      <ComplaintRecordSection
        entries={entries}
        complaintNote="Weighed against the turnout record."
        decisionReason="The grievance did not change the outcome."
      />,
    );

    // Substantiated — findings stay hidden until the Nature of Complaint is
    // clicked, exactly like the Electoral Board's Stage 5 view.
    expect(screen.getByText(/Substantiated grievances? on record \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText("Ballot receipts confirmed a proxy vote.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Vote buying/ }));
    expect(screen.getByText("Ballot receipts confirmed a proxy vote.")).toBeInTheDocument();

    // The other resolutions are only noted.
    expect(screen.getByText(/Complaint decisions \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Late posting of results")).toBeInTheDocument();
    expect(screen.getByText("Unsubstantiated Grievance")).toBeInTheDocument();

    // Whatever is still on file is flagged, never hidden.
    expect(screen.getByText(/1 complaint is still on file/)).toBeInTheDocument();
    expect(screen.getByText("Campaigning inside the precinct")).toBeInTheDocument();

    // The Board's public words are part of the record.
    expect(
      screen.getByText(/Complaint Reason: The grievance did not change the outcome\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Electoral Board note: Weighed against the turnout record\./),
    ).toBeInTheDocument();
  });

  it("omits the findings and renames the explanation on the public results pages", () => {
    render(
      <ComplaintRecordSection
        entries={entries}
        decisionReason="The grievance did not change the outcome."
        decisionReasonLabel="Complaint Resolution and Justification"
        showFindings={false}
      />,
    );

    // The findings never render — and there is nothing to click.
    expect(screen.queryByText("Ballot receipts confirmed a proxy vote.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vote buying/ })).not.toBeInTheDocument();
    // The substantiated grievance is still on the record, as a plain row.
    expect(screen.getByText(/Substantiated grievance on record \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/· Substantiated Grievance/)).toBeInTheDocument();
    // The Board's explanation keeps its public name.
    expect(
      screen.getByText(
        /Complaint Resolution and Justification: The grievance did not change the outcome\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Complaint Reason: /)).not.toBeInTheDocument();
  });
});
