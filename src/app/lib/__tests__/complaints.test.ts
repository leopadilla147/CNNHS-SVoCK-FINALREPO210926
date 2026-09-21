import { describe, it, expect } from "vitest";
import { toComplaintDto, buildSubmitPayload, statusLabel, statusMeta, sortFiledFirst } from "../complaints";
import type { Complaint } from "../../context/AppContext";

describe("buildSubmitPayload", () => {
  it("maps client fields to the 028 column names with the D-01 default omitted", () => {
    expect(buildSubmitPayload(
      { title: "Vote buying", description: "Candidate X offered money." },
      "student-123"
    )).toEqual({
      student_id: "student-123",
      subject: "Vote buying",
      description: "Candidate X offered money.",
      incident_date: null,
    });
  });

  it("carries an optional incident date", () => {
    expect(buildSubmitPayload(
      { title: "Harassment", description: "...", incidentDate: "2026-09-18" },
      "student-123"
    ).incident_date).toBe("2026-09-18");
  });
});

describe("toComplaintDto", () => {
  it("maps the 028 columns into the client shape with the D-01 statuses", () => {
    const dto = toComplaintDto({
      id: "c1",
      students: { first_name: "Juan", last_name: "Dela Cruz" },
      subject: "Vote buying",
      description: "details",
      status: "filed",
      submitted_at: "2026-09-18T01:00:00+08:00",
      resolution_note: "Rejected: insufficient evidence",
      incident_date: "2026-09-17T10:00:00+08:00",
      resolved_at: "2026-09-19T02:00:00+08:00",
    });
    expect(dto).toEqual({
      id: "c1",
      studentName: "Juan Dela Cruz",
      subject: "Vote buying",
      description: "details",
      status: "filed",
      submittedAt: "2026-09-18",
      rejectionReason: "Rejected: insufficient evidence",
      incidentDate: "2026-09-17",
      resolvedAt: "2026-09-19",
    });
  });

  it("defaults the student name and tolerates missing optional columns", () => {
    const dto = toComplaintDto({
      id: "c2",
      subject: "Noise",
      description: "loud music",
      status: "accepted",
      submitted_at: "2026-09-18T01:00:00+08:00",
    });
    expect(dto.studentName).toBe("Student");
    expect(dto.rejectionReason).toBeUndefined();
    expect(dto.incidentDate).toBeUndefined();
    expect(dto.resolvedAt).toBeUndefined();
  });
});

describe("statusLabel", () => {
  it("produces the three D-01 labels", () => {
    expect(statusLabel("filed")).toBe("Filed");
    expect(statusLabel("accepted")).toBe("Accepted");
    expect(statusLabel("rejected")).toBe("Rejected");
  });
});

describe("statusMeta", () => {
  it("covers all three D-01 statuses with label + tone", () => {
    expect(statusMeta("filed")).toEqual({ label: "Filed", tone: "amber" });
    expect(statusMeta("accepted")).toEqual({ label: "Accepted", tone: "green" });
    expect(statusMeta("rejected")).toEqual({ label: "Rejected", tone: "red" });
  });
});

describe("sortFiledFirst", () => {
  const row = (id: string, status: Complaint["status"], submittedAt: string): Complaint => ({
    id,
    studentName: "Juan Dela Cruz",
    subject: "s",
    description: "d",
    status,
    submittedAt,
  });

  it("orders filed first, then accepted, then rejected (D-11)", () => {
    const rows = [
      row("r1", "rejected", "2026-09-01"),
      row("r2", "accepted", "2026-09-02"),
      row("r3", "filed", "2026-09-03"),
    ];
    expect(sortFiledFirst(rows).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("is stable by submitted_at desc inside each status group", () => {
    const rows = [
      row("a1", "filed", "2026-09-01"),
      row("a2", "filed", "2026-09-05"),
      row("a3", "filed", "2026-09-03"),
    ];
    expect(sortFiledFirst(rows).map((r) => r.id)).toEqual(["a2", "a3", "a1"]);
  });
});