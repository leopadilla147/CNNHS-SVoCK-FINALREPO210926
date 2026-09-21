import { describe, it, expect } from "vitest";
import { generateComeaCertificate, generateChiefElectionReport } from "../reports";
import type { Candidate } from "../../context/AppContext";

function candidate(id: string, surname: string, givenName: string): Candidate {
  return {
    id,
    surname,
    givenName,
    gradeLevel: "Grade 11",
    position: "President",
    gender: "Male",
    dateOfBirth: "2009-01-01",
    age: 17,
    email: `${givenName.toLowerCase()}@test.local`,
    mobileNumber: "09171234567",
    homeAddress: "Daet, Camarines Norte",
    documents: {
      applicationForm: true,
      introductoryProfile: true,
      screeningForm: true,
      reportCard: true,
      goodMoralCert: true,
    },
    status: "approved",
    submittedAt: "2026-01-01T00:00:00Z",
    votes: 0,
    studentId: "student-1",
  };
}

describe("generateComeaCertificate", () => {
  it("returns a non-empty HTML document", () => {
    const html = generateComeaCertificate({
      studentName: "Juan Dela Cruz",
      position: "President",
      academicYear: "2026-2027",
    });
    expect(html.length).toBeGreaterThan(200);
  });

  it("embeds the certificate artwork as a data-URI image", () => {
    const html = generateComeaCertificate({
      studentName: "Maria Santos",
      position: "Secretary",
      academicYear: "2026-2027",
    });
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain('<img class="art"');
  });

  it("escapes a malicious studentName so it cannot inject markup (D-14)", () => {
    const html = generateComeaCertificate({
      studentName: `</div><script>alert(1)</script><div class="x">`,
      position: `President"><img src=x onerror=alert(2)>`,
      academicYear: "2026-2027",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<div class=\"x\">");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });
});

describe("generateChiefElectionReport", () => {
  const sampleInput = {
    periodLabel: "2026-2027",
    totals: { totalVoters: 100, voted: 75, notVoted: 25, turnoutPct: 75 },
    approvedCandidates: [candidate("1", "Dela Cruz", "Juan"), candidate("2", "Santos", "Maria")],
    results: [
      {
        position: "President",
        winnerName: "Juan Dela Cruz",
        party: "Independent",
        gradeLevel: "Grade 11",
        votes: 120,
      },
    ],
  };

  it("returns a non-empty HTML document", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html.length).toBeGreaterThan(200);
  });

  it("mirrors the COMEA accomplishment-report headings", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).toContain("ACCOMPLISHMENT REPORT");
    expect(html).toContain("DETAILS OF THE ACTIVITY");
    expect(html).toContain("Election Summary / Highlights");
  });

  it("renders the results table with totals", () => {
    const html = generateChiefElectionReport(sampleInput);
    expect(html).toContain("Juan Dela Cruz");
    expect(html).toContain("75%");
    expect(html).toContain("<td style=\"text-align:center;\">120</td>");
  });

  it("escapes a marked-up winnerName before it enters the HTML (D-14)", () => {
    const html = generateChiefElectionReport({
      ...sampleInput,
      results: [{ ...sampleInput.results[0], winnerName: `<img src=x onerror=alert(9)>` }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("shows an empty-results fallback when no results are passed", () => {
    const html = generateChiefElectionReport({ ...sampleInput, results: [] });
    expect(html).toContain("No results to report");
  });
});