import { describe, it, expect } from "vitest";
import { toComplaintDto, buildSubmitPayload, statusLabel, statusMeta, sortFiledFirst, complaintWindowOpen, complaintsForElection, COMPLAINT_SUBJECTS, COMPLAINT_SUBJECT_OTHERS, resolveComplaintSubject, validateComplaintForm, todayDateStr, formatSubmittedAt, validateEvidenceFiles, toEvidenceArray, isImageEvidence, complaintDecisionLabel, complaintDecisionDefinition, substantiatedComplaints, COMPLAINT_AGAINST_OPTIONS, COMPLAINT_AGAINST_OTHERS, resolveComplaintAgainst, EVIDENCE_ACCEPT, EVIDENCE_MAX_FILES, COMPLAINT_SANCTION_VALUES, COMPLAINT_SANCTION_LABELS, complaintSanctionLabel, complaintSanctionsSummary, hasDisqualificationSanction, disqualifiedCandidatesSummary, toSanctionArray, toDisqualifiedCandidates } from "../complaints";
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
      findings_note: "Reviewed CCTV footage; statement taken from the canvasser.",
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
      submittedAtExact: "2026-09-18T01:00:00+08:00",
      decision: undefined,
      sanctions: [],
      disqualifiedCandidates: [],
      evidence: [],
      findingsEvidence: [],
      rejectionReason: "Rejected: insufficient evidence",
      findings: "Reviewed CCTV footage; statement taken from the canvasser.",
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
    expect(dto.findings).toBeUndefined();
    expect(dto.incidentDate).toBeUndefined();
    expect(dto.resolvedAt).toBeUndefined();
  });
});

describe("statusLabel", () => {
  it("produces the three D-01 labels with the 086 'Resolved' wording", () => {
    expect(statusLabel("filed")).toBe("Filed");
    expect(statusLabel("accepted")).toBe("Resolved");
    expect(statusLabel("rejected")).toBe("Rejected");
  });
});

describe("statusMeta", () => {
  it("covers all three D-01 statuses with label + tone", () => {
    expect(statusMeta("filed")).toEqual({ label: "Filed", tone: "amber" });
    expect(statusMeta("accepted")).toEqual({ label: "Resolved", tone: "green" });
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

describe("complaintWindowOpen", () => {
  it("opens at the campaign stage and stays open through voting (089)", () => {
    expect(complaintWindowOpen({ lifecycleStage: "campaign" })).toBe(true);
    expect(complaintWindowOpen({ lifecycleStage: "fingerprint_registration" })).toBe(true);
    expect(complaintWindowOpen({ lifecycleStage: "voting" })).toBe(true);
  });

  it("is closed before the campaign and closes as soon as voting ends", () => {
    expect(complaintWindowOpen({ lifecycleStage: "application" })).toBe(false);
    expect(complaintWindowOpen({ lifecycleStage: "results" })).toBe(false);
    expect(complaintWindowOpen({ lifecycleStage: "completed" })).toBe(false);
    expect(complaintWindowOpen({})).toBe(false);
  });
});

describe("complaintsForElection", () => {
  const row = (id: string, electionPeriodId?: string): Complaint => ({
    id,
    studentName: "Juan Dela Cruz",
    subject: "s",
    description: "d",
    status: "filed",
    submittedAt: "2026-09-01",
    electionPeriodId,
  });

  it("keeps only the complaints filed under the current election (089)", () => {
    const rows = [
      row("current-1", "period-2"),
      row("past-1", "period-1"),
      row("current-2", "period-2"),
    ];
    expect(complaintsForElection(rows, "period-2").map((r) => r.id)).toEqual(["current-1", "current-2"]);
  });

  it("shows nothing when there is no current election period", () => {
    expect(complaintsForElection([row("c1", "period-1")], undefined)).toEqual([]);
    expect(complaintsForElection([row("c1", "period-1")], "")).toEqual([]);
  });
});

describe("COMPLAINT_SUBJECTS (Nature of Complaint)", () => {
  it("offers the new nature-of-complaint options with Others last", () => {
    expect(COMPLAINT_SUBJECTS).toEqual([
      "Dishonesty",
      "Oppression",
      "Disgraceful and Immoral Conduct",
      "Impersonation",
      "Falsification",
      "Vote Solicitation",
      "Negligence of Duty",
      "Misconduct",
      COMPLAINT_SUBJECT_OTHERS,
    ]);
  });
});

describe("COMPLAINT_AGAINST_OPTIONS", () => {
  it("offers the complaint-against options with Others last", () => {
    expect(COMPLAINT_AGAINST_OPTIONS).toEqual([
      "Learner Government COMEA",
      "Teacher",
      "Learner",
      "Candidate",
      "Political Party",
      COMPLAINT_AGAINST_OTHERS,
    ]);
  });
});

describe("resolveComplaintSubject / resolveComplaintAgainst", () => {
  it("uses the dropdown value unless Others is picked", () => {
    expect(resolveComplaintSubject("Misconduct", "ignored")).toBe("Misconduct");
    expect(resolveComplaintAgainst("Teacher", "ignored")).toBe("Teacher");
  });

  it("uses the free-text value when Others is picked", () => {
    expect(resolveComplaintSubject(COMPLAINT_SUBJECT_OTHERS, "  Bribing the SSLG adviser  ")).toBe("Bribing the SSLG adviser");
    expect(resolveComplaintAgainst(COMPLAINT_AGAINST_OTHERS, "  the SSLG adviser  ")).toBe("the SSLG adviser");
  });
});

describe("validateComplaintForm", () => {
  const valid = {
    complaintAgainst: "Teacher",
    otherAgainst: "",
    subject: "Misconduct",
    otherSubject: "",
    description: "Narrative of what happened.",
    incidentDate: "2026-10-22",
    certified: true,
  };

  it("accepts a complete form", () => {
    expect(validateComplaintForm(valid)).toEqual({});
  });

  it("requires a complaint-against, with the free text when Others is picked", () => {
    expect(validateComplaintForm({ ...valid, complaintAgainst: "" }).complaintAgainst).toBe("Please select who the complaint is against.");
    const errors = validateComplaintForm({ ...valid, complaintAgainst: COMPLAINT_AGAINST_OTHERS, otherAgainst: "  " });
    expect(errors.complaintAgainst).toBe("Please specify who or what the complaint is against.");
    expect(validateComplaintForm({ ...valid, complaintAgainst: COMPLAINT_AGAINST_OTHERS, otherAgainst: "A group of students" }).complaintAgainst).toBeUndefined();
  });

  it("requires the nature of the complaint", () => {
    expect(validateComplaintForm({ ...valid, subject: "" }).subject).toBe("Please select the nature of your complaint.");
  });

  it("requires the free text when Others is picked", () => {
    const errors = validateComplaintForm({ ...valid, subject: COMPLAINT_SUBJECT_OTHERS, otherSubject: "  " });
    expect(errors.subject).toBe("Please specify the nature of your complaint.");
    expect(validateComplaintForm({ ...valid, subject: COMPLAINT_SUBJECT_OTHERS, otherSubject: "Bribery" }).subject).toBeUndefined();
  });

  it("requires a narrative report", () => {
    expect(validateComplaintForm({ ...valid, description: "   " }).description).toBe("Please provide a narrative report.");
  });

  it("rejects a punctuation-and-spaces-only narrative report", () => {
    expect(validateComplaintForm({ ...valid, description: ". . ." }).description).toBe(
      "The narrative report must contain actual words — punctuation and spaces alone are not allowed."
    );
    expect(validateComplaintForm({ ...valid, description: "." }).description).toMatch(/actual words/);
    expect(validateComplaintForm({ ...valid, description: "The candidate shouted at me during the meeting." }).description).toBeUndefined();
  });

  it("rejects a punctuation-only Others subject and against", () => {
    expect(validateComplaintForm({ ...valid, subject: COMPLAINT_SUBJECT_OTHERS, otherSubject: ". ." }).subject).toBe(
      "The nature of the complaint must contain actual words — punctuation and spaces alone are not allowed."
    );
    expect(validateComplaintForm({ ...valid, complaintAgainst: COMPLAINT_AGAINST_OTHERS, otherAgainst: ". ." }).complaintAgainst).toBe(
      "Who or what the complaint is against must contain actual words — punctuation and spaces alone are not allowed."
    );
    expect(
      validateComplaintForm({ ...valid, subject: COMPLAINT_SUBJECT_OTHERS, otherSubject: "Bribery during screening" }).subject
    ).toBeUndefined();
  });

  it("requires a date but allows a past incident date", () => {
    expect(validateComplaintForm({ ...valid, incidentDate: "" }).incidentDate).toBe("Please select the date of the incident.");
    expect(validateComplaintForm({ ...valid, incidentDate: "2026-10-21" }).incidentDate).toBeUndefined();
    expect(validateComplaintForm({ ...valid, incidentDate: "2020-01-05" }).incidentDate).toBeUndefined();
  });

  it("allows today but rejects a future incident date", () => {
    expect(validateComplaintForm({ ...valid, incidentDate: todayDateStr() }).incidentDate).toBeUndefined();
    expect(validateComplaintForm({ ...valid, incidentDate: `${new Date().getFullYear() + 1}-01-01` }).incidentDate).toBe(
      "The date of the incident cannot be in the future."
    );
  });

  it("requires the certification checkbox", () => {
    expect(validateComplaintForm({ ...valid, certified: false }).certified).toBe("Please certify that the information is true and correct before filing.");
  });
});

describe("formatSubmittedAt", () => {
  it("renders the date and 12-hour time from the raw timestamp", () => {
    const formatted = formatSubmittedAt({ submittedAt: "2026-10-22", submittedAtExact: "2026-10-22T15:45:00+08:00" });
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/at/);
    expect(formatted).toMatch(/(AM|PM)/);
  });

  it("falls back to the date-only value when the timestamp is missing", () => {
    expect(formatSubmittedAt({ submittedAt: "2026-10-22" })).toBe("2026-10-22");
    expect(formatSubmittedAt({ submittedAt: "2026-10-22", submittedAtExact: "not-a-date" })).toBe("2026-10-22");
  });
});

describe("complaint decisions (097)", () => {
  const row = (id: string, decision?: Complaint["decision"]): Complaint => ({
    id,
    studentName: "Juan Dela Cruz",
    subject: "s",
    description: "d",
    status: "accepted",
    submittedAt: "2026-09-01",
    decision,
  });

  it("labels each decision and the unclassified legacy case", () => {
    expect(complaintDecisionLabel("substantiated")).toBe("Substantiated Grievance");
    expect(complaintDecisionLabel("unsubstantiated")).toBe("Unsubstantiated Grievance");
    expect(complaintDecisionLabel("dismissed")).toBe("Dismissed Grievance");
    expect(complaintDecisionLabel(undefined)).toBe("Not classified");
  });

  it("maps the decision column into the client shape", () => {
    expect(toComplaintDto({ id: "c1", status: "accepted", submitted_at: "2026-09-18T01:00:00+08:00", decision: "substantiated" }).decision).toBe("substantiated");
  });

  it("documents what each decision means", () => {
    expect(complaintDecisionDefinition("substantiated")).toBe("The complaint is supported by evidence.");
    expect(complaintDecisionDefinition("unsubstantiated")).toBe("There is insufficient evidence to establish the allegation.");
    expect(complaintDecisionDefinition("dismissed")).toBe("The complaint is closed without further action, according to the applicable rules.");
    expect(complaintDecisionDefinition(undefined)).toBe("");
  });

  it("keeps only the substantiated grievances", () => {
    const rows = [row("a", "substantiated"), row("b", "dismissed"), row("c"), row("d", "substantiated")];
    expect(substantiatedComplaints(rows).map((r) => r.id)).toEqual(["a", "d"]);
  });
});

describe("evidence helpers", () => {
  // validateEvidenceFiles only reads name/type/size, so a plain cast is enough.
  const file = (name: string, type: string, size = 1024): File =>
    ({ name, type, size } as unknown as File);

  it("exposes an accept string that includes images, PDF and Word", () => {
    expect(EVIDENCE_ACCEPT).toContain("image/jpeg");
    expect(EVIDENCE_ACCEPT).toContain("application/pdf");
    expect(EVIDENCE_ACCEPT).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(EVIDENCE_MAX_FILES).toBe(5);
  });

  it("asks for at least one file when nothing is picked", () => {
    expect(validateEvidenceFiles([])).toMatch(/at least one file/i);
  });

  it("accepts allowed files within the limits", () => {
    expect(validateEvidenceFiles([file("a.jpg", "image/jpeg"), file("b.pdf", "application/pdf")])).toBeNull();
  });

  it("rejects a disallowed file type", () => {
    expect(validateEvidenceFiles([file("a.exe", "application/x-msdownload")])).toMatch(/not an allowed file type/i);
  });

  it("rejects files over 10 MB", () => {
    expect(validateEvidenceFiles([file("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)])).toMatch(/larger than 10 MB/i);
  });

  it("rejects a running total over the file cap", () => {
    const picks = [file("a.jpg", "image/jpeg")];
    expect(validateEvidenceFiles(picks, EVIDENCE_MAX_FILES)).toMatch(/at most 5 files/i);
  });

  it("detects image attachments by extension for the thumbnail preview", () => {
    expect(isImageEvidence("photo.JPG")).toBe(true);
    expect(isImageEvidence("scan.png")).toBe(true);
    expect(isImageEvidence("shot.webp")).toBe(true);
    expect(isImageEvidence("evidence.pdf")).toBe(false);
    expect(isImageEvidence("report.docx")).toBe(false);
    expect(isImageEvidence(undefined)).toBe(false);
  });

  it("normalizes a raw jsonb evidence column", () => {
    expect(toEvidenceArray([
      { url: "https://x/complaint-evidence/a.jpg", name: "a.jpg" },
      { url: "https://x/complaint-evidence/b.pdf" },
      { url: 123 },
      null,
    ])).toEqual([
      { url: "https://x/complaint-evidence/a.jpg", name: "a.jpg" },
      { url: "https://x/complaint-evidence/b.pdf", name: "Evidence" },
    ]);
    expect(toEvidenceArray(null)).toEqual([]);
    expect(toEvidenceArray("nope")).toEqual([]);
  });
});

describe("complaint sanctions (127)", () => {
  it("offers the three sanctions with their human labels", () => {
    expect(COMPLAINT_SANCTION_VALUES).toEqual(["verbal_warning", "reprimand", "disqualification"]);
    expect(COMPLAINT_SANCTION_LABELS.verbal_warning).toBe("Verbal Warning");
    expect(COMPLAINT_SANCTION_LABELS.reprimand).toBe("Reprimand Through Writing");
    expect(COMPLAINT_SANCTION_LABELS.disqualification).toBe("Disqualification");
    expect(complaintSanctionLabel("reprimand")).toBe("Reprimand Through Writing");
  });

  it("summarizes the imposed sanctions", () => {
    expect(complaintSanctionsSummary(["verbal_warning"])).toBe("Verbal Warning");
    expect(complaintSanctionsSummary(["verbal_warning", "disqualification"])).toBe(
      "Verbal Warning, Disqualification"
    );
    expect(complaintSanctionsSummary([])).toBe("");
    expect(complaintSanctionsSummary(undefined)).toBe("");
  });

  it("detects a Disqualification sanction", () => {
    expect(hasDisqualificationSanction(["verbal_warning", "disqualification"])).toBe(true);
    expect(hasDisqualificationSanction(["reprimand"])).toBe(false);
    expect(hasDisqualificationSanction(undefined)).toBe(false);
  });

  it("normalizes a raw sanctions column, dropping unknown values", () => {
    expect(toSanctionArray(["verbal_warning", "reprimand"])).toEqual(["verbal_warning", "reprimand"]);
    expect(toSanctionArray(["bribery", 42, null])).toEqual([]);
    expect(toSanctionArray(null)).toEqual([]);
    expect(toSanctionArray("verbal_warning")).toEqual([]);
  });

  it("pairs the disqualified candidate ids with their denormalized names", () => {
    expect(toDisqualifiedCandidates(["id-1", "id-2"], ["Juan Dela Cruz", "Maria Santos"])).toEqual([
      { id: "id-1", name: "Juan Dela Cruz" },
      { id: "id-2", name: "Maria Santos" },
    ]);
    // Names without ids still render; ids without names do not.
    expect(toDisqualifiedCandidates([], ["Juan Dela Cruz"])).toEqual([{ id: "", name: "Juan Dela Cruz" }]);
    expect(toDisqualifiedCandidates(["id-1"], [])).toEqual([]);
    expect(toDisqualifiedCandidates(null, null)).toEqual([]);
    expect(disqualifiedCandidatesSummary([{ id: "id-1", name: "Juan Dela Cruz" }])).toBe("Juan Dela Cruz");
    expect(disqualifiedCandidatesSummary([{ id: "id-1", name: "" }])).toBe("");
  });

  it("maps the sanctions columns into the client shape", () => {
    const dto = toComplaintDto({
      id: "c1",
      status: "accepted",
      submitted_at: "2026-09-18T01:00:00+08:00",
      decision: "substantiated",
      sanctions: ["verbal_warning", "disqualification"],
      disqualified_candidate_ids: ["cand-1"],
      disqualified_candidate_names: ["Juan Dela Cruz"],
    });
    expect(dto.sanctions).toEqual(["verbal_warning", "disqualification"]);
    expect(dto.disqualifiedCandidates).toEqual([{ id: "cand-1", name: "Juan Dela Cruz" }]);
  });

  it("leaves sanctions empty for complaints resolved without them", () => {
    const dto = toComplaintDto({ id: "c2", status: "accepted", submitted_at: "2026-09-18T01:00:00+08:00" });
    expect(dto.sanctions).toEqual([]);
    expect(dto.disqualifiedCandidates).toEqual([]);
  });
});