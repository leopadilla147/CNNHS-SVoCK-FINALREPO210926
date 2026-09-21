import type { Candidate, Student, ElectionPeriod, Complaint, Commissioner, LogEntry } from "../context/AppContext";
import { escapeHtml } from "./escapeHtml";
import comeaCertificateArt from "../../assets/templates/COMEACertificate.png?inline";

function depEdHeader(title: string, enclosure: string): string {
  return `
    <div style="text-align:center; font-family:'Times New Roman',serif; margin-bottom:20px;">
      <div style="font-size:11pt; font-weight:bold;">Republic of the Philippines</div>
      <div style="font-size:12pt; font-weight:bold;">DEPARTMENT OF EDUCATION</div>
      <div style="font-size:11pt;">Region V – Bicol Region</div>
      <div style="font-size:11pt; font-weight:bold;">CAMARINES NORTE NATIONAL HIGH SCHOOL</div>
      <div style="font-size:10pt;">Daet, Camarines Norte</div>
      <hr style="border:1px solid #000; margin:8px 0;" />
      <div style="font-size:11pt; font-weight:bold;">Enclosure No. ${enclosure}</div>
      <div style="font-size:12pt; font-weight:bold; margin-top:4px;">${title}</div>
      <hr style="border:1px solid #000; margin:8px 0;" />
    </div>`;
}

function footer(): string {
  return `
    <div style="text-align:center; font-size:8pt; font-family:'Times New Roman',serif; margin-top:30px; border-top:1px solid #ccc; padding-top:6px;">
      CNNHS Online Voting System &mdash; Document generated on ${new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
    </div>`;
}

export function openPrintWindow(html: string) {
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to print reports.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report</title>
<style>
  @page { margin: 1in; size: portrait; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.4; color: #000; padding: 20px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
  th, td { border: 1px solid #000; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #e8e8e8; font-weight: bold; text-align: center; }
  .signature { margin-top: 40px; display: flex; justify-content: space-between; }
  .signature div { text-align: center; width: 40%; }
  .signature .line { border-top: 1px solid #000; margin-top: 50px; padding-top: 5px; font-weight: bold; }
  .note { font-size: 9pt; font-style: italic; margin: 10px 0; }
  .letter-head { text-align: center; font-family: 'Times New Roman', serif; }
  .letter-head hr { border: 1px solid #000; }
  h2 { text-align: center; font-size: 13pt; margin: 15px 0; }
  h3 { font-size: 11pt; margin: 10px 0 5px; }
  ul { margin: 3px 0; padding-left: 20px; }
  @media print { body { padding: 0; } }
</style></head><body>`);
  w.document.write(html);
  w.document.write('</body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
}

export function generateEnclosure6(candidates: Candidate[]) {
  const rows = candidates.filter(c => c.status === "ongoingSubmission" || c.status === "pending" || c.status === "approved")
    .map((c, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(`${c.surname}, ${c.givenName} ${c.middleName || ''}`)}</td>
      <td>${escapeHtml(c.position)}</td>
      <td>${escapeHtml(c.partyAffiliation || 'Independent')}</td>
      <td>${escapeHtml(c.gradeLevel)}</td>
      <td style="text-align:center;">${c.documents.applicationForm ? '✓' : '☐'}</td>
      <td style="text-align:center;">${c.documents.reportCard ? '✓' : '☐'}</td>
      <td style="text-align:center;">${c.documents.goodMoralCert ? '✓' : '☐'}</td>
      <td style="text-align:center;">${c.status === 'approved' ? 'Approved' : c.status === 'pending' ? 'For Review' : 'In Progress'}</td>
    </tr>`).join('');

  const html = `${depEdHeader('Certificate of Candidacy / Election Application Form Tracking', '6')}
    <h2>EAF TRACKING SHEET</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; Supreme Secondary Learner Government (SSLG) Election</p>
    <table><thead><tr>
      <th style="width:30px;">#</th>
      <th>Name of Candidate</th>
      <th>Position</th>
      <th>Party</th>
      <th>Grade</th>
      <th style="width:50px;">App Form</th>
      <th style="width:50px;">Report Card</th>
      <th style="width:50px;">Good Moral</th>
      <th>Status</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="9" style="text-align:center;">No records</td></tr>'}</tbody></table>
    <p class="note">Prepared by the Commissioner of Screening and Validation. This form tracks the completeness of each candidate's EAF and supporting documents.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Screening and Validation</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure72(candidates: Candidate[]) {
  const approved = candidates.filter(c => c.status === "approved");
  const pending = candidates.filter(c => c.status === "pending");
  const rejected = candidates.filter(c => c.status === "rejected");

  const rows = candidates.filter(c => c.status !== "ongoingSubmission").map((c, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(`${c.surname}, ${c.givenName}`)}</td>
    <td>${escapeHtml(c.position)}</td>
    <td>${escapeHtml(c.partyAffiliation || 'Independent')}</td>
    <td style="text-align:center;">${escapeHtml(c.gradeLevel)}</td>
    <td style="text-align:center;">${c.documents.applicationForm ? '✓' : '✗'}</td>
    <td style="text-align:center;">${c.documents.screeningForm ? '✓' : '✗'}</td>
    <td style="text-align:center;">${c.status === 'approved' ? 'Passed' : c.status === 'rejected' ? 'Failed' : 'Pending'}</td>
  </tr>`).join('');

  const html = `${depEdHeader('Screening and Validation Summary', '7.2')}
    <h2>SCREENING AND VALIDATION SUMMARY REPORT</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; SSLG Election</p>
    <div style="display:flex; gap:20px; margin:10px 0; font-size:10pt;">
      <span><strong>Total Applicants:</strong> ${candidates.filter(c => c.status !== "ongoingSubmission").length}</span>
      <span><strong>Approved:</strong> ${approved.length}</span>
      <span><strong>Pending:</strong> ${pending.length}</span>
      <span><strong>Disqualified:</strong> ${rejected.length}</span>
    </div>
    <table><thead><tr>
      <th style="width:30px;">#</th>
      <th>Candidate Name</th>
      <th>Position</th>
      <th>Party</th>
      <th>Grade</th>
      <th>App Form</th>
      <th>Screening</th>
      <th>Result</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="8" style="text-align:center;">No records</td></tr>'}</tbody></table>
    <div class="signature">
      <div><div class="line">Commissioner of Screening and Validation</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure81(candidates: Candidate[]) {
  const approved = candidates.filter(c => c.status === "approved");
  const byPosition: Record<string, Candidate[]> = {};
  approved.forEach(c => {
    if (!byPosition[c.position]) byPosition[c.position] = [];
    byPosition[c.position].push(c);
  });

  let rows = '';
  let counter = 1;
  for (const [pos, cs] of Object.entries(byPosition)) {
    rows += `<tr style="background:#f0f0f0; font-weight:bold;"><td colspan="5">${escapeHtml(pos)}</td></tr>`;
    cs.forEach(c => {
      rows += `<tr><td style="text-align:center;">${counter++}</td><td>${escapeHtml(`${c.surname}, ${c.givenName} ${c.middleName || ''}`)}</td><td>${escapeHtml(c.partyAffiliation || 'Independent')}</td><td style="text-align:center;">${escapeHtml(c.gradeLevel)}</td><td style="text-align:center;">${escapeHtml(c.gender)}</td></tr>`;
    });
  }

  const html = `${depEdHeader('Official List of Candidates', '8.1')}
    <h2>OFFICIAL LIST OF CANDIDATES</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; SSLG Election</p>
    <p style="font-size:10pt;">Pursuant to the Interim Guidelines of the Learner Government Program (LGP), the following candidates are hereby officially listed for the SSLG Election:</p>
    <table><thead><tr>
      <th style="width:30px;">#</th>
      <th>Name of Candidate</th>
      <th>Party</th>
      <th>Grade</th>
      <th>Sex</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No approved candidates</td></tr>'}</tbody></table>
    <p class="note">Approved by the Chief Commissioner and posted by the Commissioner of Appointment.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Appointment</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure82(candidates: Candidate[]) {
  const approved = candidates.filter(c => c.status === "approved");

  const rows = approved.map((c, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(`${c.surname}, ${c.givenName}`)}</td>
    <td>${escapeHtml(c.position)}</td>
    <td>${escapeHtml(c.partyAffiliation || 'Independent')}</td>
    <td style="text-align:center;">Approved</td>
  </tr>`).join('');

  const html = `${depEdHeader('Notice to Candidates / Party Approval Record', '8.2')}
    <h2>NOTICE TO CANDIDATES AND PARTY APPROVAL RECORD</h2>
    <p style="font-size:10pt;">This serves as notice to all candidates and political parties regarding the approval status of their candidacy applications for the SSLG Election S.Y. 2026-2027.</p>
    <table><thead><tr>
      <th style="width:30px;">#</th>
      <th>Candidate</th>
      <th>Position</th>
      <th>Party</th>
      <th>Status</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No records</td></tr>'}</tbody></table>
    <div class="signature">
      <div><div class="line">Commissioner of Appointment</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure9(electionPeriod: ElectionPeriod) {
  const html = `${depEdHeader('Campaign and Election Calendar', '9')}
    <h2>CAMPAIGN AND ELECTION CALENDAR</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; SSLG Election</p>
    <table>
      <thead><tr><th>Activity</th><th>Date</th><th>Responsible Party</th></tr></thead>
      <tbody>
        <tr><td>Filing of Candidacy / EAF Submission</td><td>${electionPeriod.candidacyOpen ? 'Open' : 'TBD'}</td><td>Commissioner of Electoral Board</td></tr>
        <tr><td>Screening and Validation</td><td>${electionPeriod.candidacyOpen ? 'Ongoing' : 'TBD'}</td><td>Commissioner of Screening and Validation</td></tr>
        <tr><td>Posting of Official List of Candidates</td><td>${electionPeriod.candidacyOpen ? 'After approval' : 'TBD'}</td><td>Commissioner of Appointment</td></tr>
        <tr><td>Campaign Period</td><td>${electionPeriod.startDate ? escapeHtml(electionPeriod.startDate) : 'TBD'} onwards</td><td>Candidates / Parties</td></tr>
        <tr><td>Election Day (Voting)</td><td>${electionPeriod.startDate ? escapeHtml(electionPeriod.startDate) : 'TBD'} ${electionPeriod.startTime ? escapeHtml(electionPeriod.startTime) : ''} - ${electionPeriod.endDate ? escapeHtml(electionPeriod.endDate) : 'TBD'} ${electionPeriod.endTime ? escapeHtml(electionPeriod.endTime) : ''}</td><td>Commissioner of Electoral Board</td></tr>
        <tr><td>Counting and Canvassing</td><td>After voting closes</td><td>Commissioner of Electoral Board</td></tr>
        <tr><td>Proclamation of Winners</td><td>After approval of results</td><td>Chief Commissioner</td></tr>
      </tbody>
    </table>
    <p><strong>Venue:</strong> ${escapeHtml(electionPeriod.venue || 'TBD')}</p>
    <p class="note">This calendar is issued by the Commissioner of Electoral Board pursuant to LGP Interim Guidelines.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Electoral Board</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure11() {
  const html = `${depEdHeader('Nomination Form', '11')}
    <h2>NOMINATION FORM</h2>
    <p style="font-size:10pt;">(To be accomplished by the nominating student or commissioner)</p>
    <table>
      <tr><td style="width:200px;"><strong>Name of Nominee:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Grade Level:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Position Nominated For:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Nominated By:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Date of Nomination:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Reason for Nomination:</h3>
    <div style="border:1px solid #000; min-height:80px; padding:8px; margin:5px 0;"></div>
    <h3>Qualifications Check:</h3>
    <p style="font-size:10pt;">☐ The nominee is a bonafide student of CNNHS<br>
    ☐ The nominee has good academic standing<br>
    ☐ The nominee has not been convicted of any offense involving moral turpitude</p>
    <div class="signature">
      <div><div class="line">Nominated By (Signature over Printed Name)</div></div>
      <div><div class="line">Commissioner of Appointment</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure12() {
  const html = `${depEdHeader('Nominee Reply Slip', '12')}
    <h2>NOMINEE REPLY SLIP</h2>
    <p style="font-size:10pt;">(To be accomplished by the nominee and returned to the Commissioner of Appointment)</p>
    <table>
      <tr><td style="width:200px;"><strong>Name of Nominee:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Position:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Response:</h3>
    <p style="margin:10px 0;">
      ☐ <strong>ACCEPT</strong> &mdash; I accept the nomination and agree to serve if appointed.<br><br>
      ☐ <strong>DECLINE</strong> &mdash; I decline the nomination for the following reason:
    </p>
    <div style="border:1px solid #000; min-height:60px; padding:8px; margin:5px 0;"></div>
    <div class="signature">
      <div><div class="line">Nominee (Signature over Printed Name)</div></div>
      <div><div class="line">Date</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure13() {
  const html = `${depEdHeader('Appointment Recommendation', '13')}
    <h2>APPOINTMENT RECOMMENDATION</h2>
    <p style="font-size:10pt;">(To be submitted to the Chief Commissioner for final approval)</p>
    <table>
      <tr><td style="width:200px;"><strong>Recommending Party:</strong></td><td>Commissioner of Appointment</td></tr>
      <tr><td><strong>Nominee Name:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Position:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Nature of Appointment:</strong></td><td>☐ Nomination ☐ Special Election ☐ Designation</td></tr>
    </table>
    <h3>Basis for Recommendation:</h3>
    <div style="border:1px solid #000; min-height:80px; padding:8px; margin:5px 0;"></div>
    <h3>Recommendation:</h3>
    <p>☐ Approved for Appointment &nbsp;&nbsp; ☐ Needs Further Review &nbsp;&nbsp; ☐ Disapproved</p>
    <div class="signature">
      <div><div class="line">Commissioner of Appointment</div></div>
      <div><div class="line">Chief Commissioner (Final Approval)</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure14() {
  const html = `${depEdHeader('Complaint Form', '14')}
    <h2>COMPLAINT FORM</h2>
    <p style="font-size:10pt;">(To be accomplished by the complainant and submitted to the Commissioner of Grievance)</p>
    <table>
      <tr><td style="width:200px;"><strong>Name of Complainant:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Grade Level:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Contact Information:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Date of Complaint:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Subject of Complaint:</h3>
    <div style="border:1px solid #000; min-height:30px; padding:8px; margin:5px 0;"></div>
    <h3>Details / Description of Complaint:</h3>
    <div style="border:1px solid #000; min-height:100px; padding:8px; margin:5px 0;"></div>
    <h3>Supporting Evidence:</h3>
    <p style="font-size:10pt;">☐ Documentary Evidence &nbsp;&nbsp; ☐ Witness(es) &nbsp;&nbsp; ☐ Photographs/Videos &nbsp;&nbsp; ☐ Other: _________</p>
    <p class="note">I hereby attest that the above information is true and correct to the best of my knowledge.</p>
    <div class="signature">
      <div><div class="line">Complainant (Signature over Printed Name)</div></div>
      <div><div class="line">Commissioner of Grievance</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure15() {
  const html = `${depEdHeader('Fact-Finding Report', '15')}
    <h2>FACT-FINDING REPORT</h2>
    <p style="font-size:10pt;">(To be accomplished by the Commissioner of Grievance)</p>
    <table>
      <tr><td style="width:200px;"><strong>Complaint Reference No.:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Subject of Complaint:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Complainant:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Respondent(s):</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Date of Investigation:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Findings:</h3>
    <div style="border:1px solid #000; min-height:120px; padding:8px; margin:5px 0;"></div>
    <h3>Conclusion:</h3>
    <div style="border:1px solid #000; min-height:60px; padding:8px; margin:5px 0;"></div>
    <h3>Recommendation:</h3>
    <p>☐ Dismiss &nbsp;&nbsp; ☐ Proceed to Initial Decision &nbsp;&nbsp; ☐ Refer to Higher Authority</p>
    <div class="signature">
      <div><div class="line">Commissioner of Grievance</div></div>
      <div><div class="line">Date</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure16() {
  const html = `${depEdHeader('Initial Decision for Chief Approval', '16')}
    <h2>INITIAL DECISION</h2>
    <p style="font-size:10pt;">(For Chief Commissioner's approval)</p>
    <table>
      <tr><td style="width:200px;"><strong>Complaint Reference No.:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Subject:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Date of Decision:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Initial Decision:</h3>
    <div style="border:1px solid #000; min-height:100px; padding:8px; margin:5px 0;"></div>
    <h3>Sanction(s) Recommended (if any):</h3>
    <div style="border:1px solid #000; min-height:60px; padding:8px; margin:5px 0;"></div>
    <p style="font-size:10pt; font-weight:bold; margin-top:15px;">☐ Approved &nbsp;&nbsp; ☐ Denied &nbsp;&nbsp; ☐ Returned for Further Investigation</p>
    <div class="signature">
      <div><div class="line">Commissioner of Grievance</div></div>
      <div><div class="line">Chief Commissioner (Final Approval)</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure17() {
  const html = `${depEdHeader('Resolution and Sanction Notice', '17')}
    <h2>RESOLUTION AND SANCTION NOTICE</h2>
    <p style="font-size:10pt;">(Official resolution of the Grievance Committee approved by the Chief Commissioner)</p>
    <table>
      <tr><td style="width:200px;"><strong>Resolution No.:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Subject:</strong></td><td>_____________________________</td></tr>
      <tr><td><strong>Date of Resolution:</strong></td><td>_____________________________</td></tr>
    </table>
    <h3>Resolution:</h3>
    <div style="border:1px solid #000; min-height:100px; padding:8px; margin:5px 0;"></div>
    <h3>Sanction(s) Imposed:</h3>
    <div style="border:1px solid #000; min-height:60px; padding:8px; margin:5px 0;"></div>
    <p class="note">This resolution is final and executory. Any violation hereof shall be dealt with accordingly.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Grievance</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure18(candidates: Candidate[]) {
  const approved = candidates.filter(c => c.status === "approved");
  const positions = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO", "PIO", "Protocol Officer"];

  let tables = '';
  positions.forEach(pos => {
    const cs = approved.filter(c => c.position === pos).sort((a, b) => b.votes - a.votes);
    if (cs.length === 0) return;
    const total = cs.reduce((s, c) => s + c.votes, 0);
    tables += `<h3>${pos}</h3><table><thead><tr><th style="width:30px;">#</th><th>Candidate</th><th>Party</th><th style="width:80px;">Votes</th><th style="width:60px;">%</th></tr></thead><tbody>`;
    cs.forEach((c, i) => {
      const pct = total > 0 ? ((c.votes / total) * 100).toFixed(1) : '0.0';
      tables += `<tr${i === 0 ? ' style="background:#fff5f5; font-weight:bold;"' : ''}><td>${i + 1}</td><td>${escapeHtml(`${c.surname}, ${c.givenName}`)}</td><td>${escapeHtml(c.partyAffiliation || 'Indep.')}</td><td style="text-align:center;">${c.votes}</td><td style="text-align:center;">${pct}%</td></tr>`;
    });
    tables += `<tr style="background:#f5f5f5;"><td colspan="3" style="text-align:right; font-weight:bold;">Total Votes Cast:</td><td style="text-align:center; font-weight:bold;">${total}</td><td></td></tr></tbody></table>`;
  });

  const html = `${depEdHeader('Election Returns', '18')}
    <h2>ELECTION RETURNS</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; SSLG Election</p>
    <p style="font-size:10pt;">This document contains the official tally of votes cast for each position in the SSLG Election.</p>
    ${tables || '<p style="text-align:center;">No data available.</p>'}
    <p class="note">Certified correct and true by the Commissioner of Electoral Board.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Electoral Board</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure19(candidates: Candidate[]) {
  return generateEnclosure18(candidates);
}

export function generateEnclosure20(candidates: Candidate[]) {
  const approved = candidates.filter(c => c.status === "approved");
  const positions = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PRO", "PIO", "Protocol Officer"];

  let rows = '';
  positions.forEach(pos => {
    const cs = approved.filter(c => c.position === pos).sort((a, b) => b.votes - a.votes);
    const winner = cs[0];
    if (!winner) return;
    rows += `<tr><td>${pos}</td><td>${escapeHtml(`${winner.surname}, ${winner.givenName}`)}</td><td>${escapeHtml(winner.partyAffiliation || 'Independent')}</td><td style="text-align:center;">${escapeHtml(winner.gradeLevel)}</td><td style="text-align:center;">${winner.votes}</td></tr>`;
  });

  const html = `${depEdHeader('Proclamation Report', '20')}
    <h2>PROCLAMATION REPORT</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; SSLG Election</p>
    <p style="font-size:10pt;">Pursuant to the Interim Guidelines of the Learner Government Program and the canvassing of votes, the following candidates are hereby proclaimed as the duly elected officers of the Supreme Secondary Learner Government (SSLG):</p>
    <table><thead><tr>
      <th>Position</th><th>Name of Winner</th><th>Party</th><th>Grade</th><th>Total Votes</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No winners to proclaim</td></tr>'}</tbody></table>
    <p style="font-size:10pt; margin-top:15px;">Let this proclamation be executed and published in accordance with the LGP Interim Guidelines.</p>
    <div class="signature">
      <div><div class="line">Commissioner of Electoral Board</div></div>
      <div><div class="line">Chief Commissioner</div></div>
    </div>
    ${footer()}`;
  openPrintWindow(html);
}

export function generateEnclosure21(logs: LogEntry[]) {
    const recent = logs.slice(0, 100);

    const rows = recent.map((log, i) => `<tr>
    <td style="text-align:center;">${i + 1}</td>
    <td>${escapeHtml(log.timestamp)}</td>
    <td>${escapeHtml(log.user)}</td>
    <td>${escapeHtml(log.role)}</td>
    <td>${escapeHtml(log.action)}</td>
    <td style="font-size:9pt;">${escapeHtml(log.details)}</td>
    <td style="text-align:center; text-transform:capitalize;">${escapeHtml(log.type)}</td>
  </tr>`).join('');

    const byType = (type: string) => recent.filter(l => l.type === type).length;

    const html = `${depEdHeader('System Audit Trail Report', '21')}
    <h2>SYSTEM AUDIT TRAIL REPORT</h2>
    <p style="text-align:center; font-size:10pt;">S.Y. 2026-2027 &mdash; CNNHS Online Voting System</p>
    <div style="display:flex; gap:15px; margin:10px 0; font-size:10pt;">
      <span><strong>Total Entries:</strong> ${recent.length}</span>
      <span><strong>Success:</strong> ${byType('success')}</span>
      <span><strong>Info:</strong> ${byType('info')}</span>
      <span><strong>Warnings:</strong> ${byType('warning')}</span>
      <span><strong>Errors:</strong> ${byType('error')}</span>
    </div>
    <p class="note">This report captures all system activities including logins, registrations, approvals, and other administrative actions. Timestamps are in PHT (UTC+8).</p>
    <table><thead><tr>
      <th style="width:30px;">#</th>
      <th>Timestamp</th>
      <th>User</th>
      <th>Role</th>
      <th>Action</th>
      <th>Details</th>
      <th>Type</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="7" style="text-align:center;">No audit log entries</td></tr>'}</tbody></table>
    <div class="signature">
      <div><div class="line">Chief Commissioner</div></div>
      <div><div class="line">System Administrator</div></div>
    </div>
    ${footer()}`;
    openPrintWindow(html);
  }

  // =====================================================================
  // Phase 04, Plan 04-05 — COMEA certificate + Chief Commissioner
  // election report (ELECT-03, ELECT-04)
  //
  // Both generators are PURE: they build and return the print-window HTML
  // string so the page (AdminReports, Task 2) wires openPrintWindow and
  // the tests can assert the markup (escapeHtml / data-URI) without a
  // window.  The certificate art PNG is inlined as a data URI at build
  // time (?inline) — about:blank print windows cannot resolve relative
  // asset URLs (phase key link).  Every interpolated value passes through
  // escapeHtml before entering the HTML (D-14).
  // =====================================================================

  export interface ComeaCertificateInput {
    studentName: string;
    position: string;
    academicYear: string;
  }

  export function generateComeaCertificate(input: ComeaCertificateInput): string {
    const { studentName, position, academicYear } = input;
    // ?inline yields a base64 data URI usable in an about:blank window.
    const art = comeaCertificateArt;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>COMEA Certificate</title><style>
  @page { margin: 0; size: landscape; }
  body { margin: 0; font-family: 'Times New Roman', Times, serif; }
  .cert { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  .cert img.art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; display: block; }
  .cert .text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #1a1a1a; padding: 0 12vw; box-sizing: border-box; }
  .cert .award { font-size: 15pt; letter-spacing: 2px; font-style: italic; }
  .cert .name { font-size: 34pt; font-weight: bold; font-family: 'Segoe Script', 'Brush Script MT', cursive; margin: 10px 0 4px; color: #2b2b2b; }
  .cert .pos { font-size: 17pt; font-weight: bold; margin-bottom: 8px; color: #3d3d3d; }
  .cert .rest { font-size: 12pt; max-width: 78%; line-height: 1.5; }
  .cert .year { font-size: 14pt; margin-top: 6px; font-weight: bold; }
  .cert .sig { position: absolute; bottom: 8vh; left: 0; right: 0; display: flex; justify-content: space-around; font-size: 11pt; text-align: center; }
  .cert .sig .line { border-top: 1px solid #333; padding-top: 4px; font-weight: bold; }
  .cert .sig .role { font-size: 9.5pt; font-style: italic; }
</style></head><body>
  <div class="cert">
    <img class="art" src="${art}" alt="COMEA Certificate" />
    <div class="text">
      <div class="award">is awarded to</div>
      <div class="name">${escapeHtml(studentName)}</div>
      <div class="pos">${escapeHtml(position)}</div>
      <div class="rest">for having demonstrated exemplary leadership and service in the conduct of the Student Government Election — duly certified by the LG-COMEA (Commission on Election and Appointment).</div>
      <div class="year">School Year ${escapeHtml(academicYear)}</div>
    </div>
    <div class="sig">
      <div><div class="line">LG-COMEA Student Chairperson</div><div class="role">Prepared by</div></div>
      <div><div class="line">School Head / LG-COMEA Chief Commissioner</div><div class="role">Approved by</div></div>
    </div>
  </div>
</body></html>`;
  }

  export interface ChiefElectionResultRow {
    position: string;
    winnerName: string;
    party: string;
    gradeLevel: string;
    votes: number;
  }

  export interface ChiefElectionReportInput {
    periodLabel: string;
    totals: {
      totalVoters: number;
      voted: number;
      notVoted: number;
      turnoutPct: number;
    };
    approvedCandidates: Candidate[];
    results: ChiefElectionResultRow[];
  }

  export function generateChiefElectionReport(input: ChiefElectionReportInput): string {
    const { periodLabel, totals, approvedCandidates, results } = input;
    const rows = results.map((r) => `<tr>
      <td>${escapeHtml(r.position)}</td>
      <td>${escapeHtml(r.winnerName)}</td>
      <td>${escapeHtml(r.party)}</td>
      <td style="text-align:center;">${escapeHtml(r.gradeLevel)}</td>
      <td style="text-align:center;">${r.votes}</td>
    </tr>`).join('');

    const html = `${depEdHeader('Accomplishment Report of the COMEA — Elections', `&nbsp;`)}
      <h2>ACCOMPLISHMENT REPORT — ${escapeHtml(periodLabel)} SSLG STUDENT ELECTION</h2>
      <p class="note">Accomplishment Report of the LG-COMEA (Commission on Election and Appointment) — Supreme Secondary Learner Government (SSLG).</p>
      <h3>DETAILS OF THE ACTIVITY (Rationale &amp; Objectives)</h3>
      <p style="font-size:10pt;">The conduct of the ${escapeHtml(periodLabel)} Student Election aims to promote democratic participation and leadership among the students of Camarines Norte National High School. Through this activity, students exercise their right to vote and select capable student leaders who represent their interests and contribute to the improvement of the school community — using the CNNHS Online Voting System as the digital platform for an organized, efficient, and transparent election process.</p>
      <h3>Election Summary / Highlights</h3>
      <table><thead><tr>
        <th>Metric</th><th>Value</th>
      </tr></thead><tbody>
        <tr><td>Approved Candidates</td><td style="text-align:center;">${approvedCandidates.length}</td></tr>
        <tr><td>Registered Voters</td><td style="text-align:center;">${totals.totalVoters}</td></tr>
        <tr><td>Already Voted</td><td style="text-align:center;">${totals.voted}</td></tr>
        <tr><td>Not Yet Voted</td><td style="text-align:center;">${totals.notVoted}</td></tr>
        <tr><td>Voter Turnout</td><td style="text-align:center;">${totals.turnoutPct}%</td></tr>
      </tbody></table>
      <h3>The Result of the Election and Elected SSLG Candidates</h3>
      <table><thead><tr>
        <th>Position</th><th>Name of Winner</th><th>Party</th><th>Grade</th><th>Total Votes</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No results to report</td></tr>'}</tbody></table>
      <h3>Financial Accomplishment / Liquidation Report</h3>
      <p style="font-size:10pt;">NONE</p>
      <h3>Recommendations</h3>
      <ul style="font-size:10pt;">
        <li>Continue to utilize the digital voting platform to ensure a faster, more organized, and transparent election process.</li>
        <li>Provide a more reliable internet connection and additional computer units or laptops during future student elections.</li>
        <li>Strengthen student participation in future elections by encouraging active involvement from all grade levels.</li>
      </ul>
      <div class="signature">
        <div><div class="line">LG-COMEA Student Chairperson</div><div>Prepared by</div></div>
        <div><div class="line">School Head / LG-COMEA Chief Commissioner</div><div>Approved by</div></div>
      </div>
      ${footer()}`;
    return html;
  }
