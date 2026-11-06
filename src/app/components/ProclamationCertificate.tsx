/**
 * ═══════════════════════════════════════════════════════════════════
 * PROCLAMATION CERTIFICATE — Camarines Norte National High School
 * SSLG Commission on Elections "Proclamation of Winners" certificate.
 *
 * Ported from the standalone proclamation/ generator: the same ornate
 * letter-landscape layout (maroon/gold triple border, corner
 * filigrees, watermark seal, DepEd/CNNHS header, winner photo in a
 * gold frame, official vote tally, identity block, the verbatim
 * proclamation message, leadership quote and the four signature
 * blocks), filled in per proclaimed winner.
 *
 * The PDF is assembled with html2canvas-pro + jsPDF — the same lazy
 * import pattern as the EAF download (html2canvas-pro is required
 * because Tailwind 4's palette emits oklch() colors).  The component
 * only renders the DOM; AdminElectionSetup mounts one off-screen per
 * proclaimed winner, and the download helpers below rasterize them.
 * ═══════════════════════════════════════════════════════════════════
 */
import { format } from "date-fns";
import cnnhsSealUrl from "../assets/proclamation-cnnhs-seal.webp";
import comeaSealUrl from "../assets/proclamation-comea-seal.png";
import "./proclamation-certificate.css";

/** A proclaimed winner row joined with the candidate's grade level —
 *  everything the certificate fills in. */
export interface CertificateWinner {
  position: string;
  winnerName: string;
  votes: number;
  /** The candidate's submitted profile photo URL, when they have one. */
  picture?: string;
  /** e.g. "Grade 12" — spoken in the proclamation message. */
  gradeLevel?: string;
}

interface ProclamationCertificateProps {
  winner: CertificateWinner;
  /** e.g. "2026-2027" — shown on the S.Y. sub-heading. */
  schoolYear?: string;
  /** e.g. "15th day of February 2026" — the proclamation date line. */
  dateLabel: string;
  /** DOM index of this certificate among all mounted winners — the
   *  download helpers capture by this attribute. */
  captureIndex: number;
}

function ordinalDay(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Fixed honorific spoken in the proclamation message — never gender-derived,
 *  so the certificate never prints a wrong title. */
const WINNER_HONORIFIC = "Ms./Mr.";

/** "15th day of February 2026" — the Board's proclamation date, or
 *  today when the stamp is missing (offline mode). */
export function proclamationDateLabel(proclaimedAt?: string | null): string {
  const parsed = proclaimedAt ? new Date(proclaimedAt) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${ordinalDay(date.getDate())} day of ${format(date, "MMMM yyyy")}`;
}

export function ProclamationCertificate({ winner, schoolYear, dateLabel, captureIndex }: ProclamationCertificateProps) {
  // "of Grade 12!" — the grade spoken in the message; a winner without a
  // grade on record simply ends the sentence after their name.
  const gradeNumber = winner.gradeLevel?.replace(/^Grade\s+/i, "");
  const votes = winner.votes;
  return (
    <div
      className="proclamation-certificate"
      data-proclamation-certificate={captureIndex}
      aria-hidden="true"
    >
      {/* Ornate certificate multi-layer borders */}
      <div className="cert-outer-border" />
      <div className="cert-mid-border" />
      <div className="cert-inner-border" />

      {/* Decorative corner filigrees */}
      <div className="corner-filigree corner-tl" />
      <div className="corner-filigree corner-tr" />
      <div className="corner-filigree corner-bl" />
      <div className="corner-filigree corner-br" />

      {/* Watermark background emblem */}
      <div className="cert-watermark">
        <img src={cnnhsSealUrl} alt="" className="watermark-img" />
      </div>

      {/* Certificate interior content */}
      <div className="cert-body">
        {/* Header section */}
        <header className="cert-header">
          <div className="cert-logo-slot">
            <img src={cnnhsSealUrl} alt="CNNHS Logo" className="cert-school-logo" />
          </div>

          <div className="cert-header-text">
            <p className="rep-title">Republic of the Philippines</p>
            <p className="deped-title">Department of Education</p>
            <p className="region-title">REGION V (BICOL) &middot; SCHOOLS DIVISION OF CAMARINES NORTE</p>
            <h2 className="school-name">CAMARINES NORTE NATIONAL HIGH SCHOOL</h2>
            <p className="school-address">Daet, Camarines Norte</p>
            <p className="election-office">
              SUPREME SECONDARY LEARNER GOVERNMENT (SSLG) COMMISSION ON ELECTIONS
            </p>
          </div>

          {/* Right seal: COMEA.  The asset is 168px for this 84px slot
              (@2x) — the exact resolution the rasterizer captures at
              scale 2, so it is drawn 1:1 and stays crisp. */}
          <div className="cert-logo-slot">
            <img src={comeaSealUrl} alt="COMEA Official Seal" className="cert-school-logo" />
          </div>
        </header>

        {/* Certificate title ribbon */}
        <div className="cert-title-container">
          <div className="title-ribbon-line" />
          <h1 className="cert-main-title">PROCLAMATION OF WINNERS</h1>
          <div className="title-ribbon-line" />
          <p className="cert-sub-heading">
            STUDENT BODY GENERAL ELECTIONS{schoolYear ? ` \u2022 S.Y. ${schoolYear}` : ""}
          </p>
        </div>

        {/* Main grid: photo, name, message & vote showcase */}
        <div className="cert-main-content">
          {/* Left column: photo & vote badge */}
          <div className="cert-left-column">
            <div className="cert-profile-card">
              <div className="profile-frame-outer">
                <div className="profile-frame-gold">
                  <div className="profile-image-wrapper">
                    {winner.picture ? (
                      <img
                        src={winner.picture}
                        alt={winner.winnerName}
                        className="profile-img"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <div className="default-avatar-wrap">
                        <svg
                          className="avatar-svg"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        </svg>
                        <span className="avatar-tag">OFFICIAL PORTRAIT</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="winner-official-badge">DULY ELECTED</div>
            </div>

            {/* Official vote tally badge */}
            <div className="cert-vote-card">
              <div className="vote-ribbon-tag">OFFICIAL VOTE TALLY</div>
              <div className="vote-number-wrap">
                <span className="vote-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </span>
                <span className="vote-number">{votes}</span>
              </div>
              <div className="vote-label">TOTAL VOTES RECEIVED</div>
              <div className="vote-verified-note">CERTIFIED ACCURATE &bull; CANVASS VERIFIED</div>
            </div>
          </div>

          {/* Right column: name, position & the required proclamation text */}
          <div className="cert-right-column">
            <div className="winner-identity-block">
              <span className="identity-lead-label">THIS CERTIFIES THAT</span>
              <h2 className="winner-display-name">
                {winner.winnerName}
              </h2>
              <div className="winner-name-underline">
                <span className="underline-diamond">&diams;</span>
              </div>
              <div className="elected-position-badge">
                <span className="position-prefix">DULY ELECTED AS</span>
                <span className="position-title">{winner.position}</span>
              </div>
            </div>

            {/* The official proclamation message (verbatim) */}
            <div className="cert-official-message">
              <p className="msg-para para-highlight">
                Congratulations on being officially elected in the position of{" "}
                <strong>{winner.position}</strong>,{" "}
                {WINNER_HONORIFIC}
                <strong> {winner.winnerName} </strong>
                {gradeNumber ? (
                  <>
                    , of <strong>Grade {gradeNumber}</strong>!
                  </>
                ) : (
                  "!"
                )}
              </p>
              <p className="msg-para">
                The entire student body of the Camarines Norte National High School welcomes you
                as one of its official student leaders who will serve with passion, commitment,
                and principles for the betterment of the school community.
              </p>
              <p className="msg-para">
                We entirely entrust this duty and responsibility given by the will of the student
                voters to you.
              </p>
              <p className="msg-para para-godspeed">
                Again, congratulations and Godspeed in your new journey ahead!
              </p>
            </div>

            {/* Leadership quotation */}
            <div className="cert-quote-box">
              <blockquote className="leadership-quote">
                &ldquo;A leader is one who knows the way, goes the way, and shows the way.&rdquo;
              </blockquote>
              <cite className="quote-author">&mdash; John C. Maxwell</cite>
            </div>
          </div>
        </div>

        {/* Footer: proclamation date & official signature blocks */}
        <footer className="cert-footer">
          <div className="proclamation-date-line">
            Given this <span>{dateLabel}</span> at Camarines Norte National High School, Daet,
            Camarines Norte.
          </div>

          <div className="signatures-grid">
            <div className="sig-block">
              <div className="sig-line" />
              <div className="sig-title">Electoral Board Chairperson</div>
              <div className="sig-office">SSLG Commission on Elections</div>
            </div>
            <div className="sig-block">
              <div className="sig-line" />
              <div className="sig-title">COMEA Teacher-Adviser</div>
              <div className="sig-office">Youth Formation Coordinator</div>
            </div>
            <div className="sig-block">
              <div className="sig-line" />
              <div className="sig-title">School Principal</div>
              <div className="sig-office">Camarines Norte National High School</div>
            </div>
            <div className="sig-block">
              <div className="sig-line" />
              <div className="sig-title">COMEA Student Chairperson</div>
              <div className="sig-office">Student Body Organization</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── PDF generation (html2canvas-pro + jsPDF, lazily imported) ──────────

const CERTIFICATE_SELECTOR = "[data-proclamation-certificate]";

/** Strip Windows-illegal filename characters. */
function safeFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, "").trim();
}

/** Wait until every image inside the certificates has finished (or
 *  failed to) load, and the document fonts are ready — the rasterizer
 *  captures whatever is painted at call time. */
async function waitForAssets(root: ParentNode): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
    ),
  );
  if (document.fonts?.ready) await document.fonts.ready;
}

/** Rasterize each certificate element into one letter-landscape PDF —
 *  a single page for one winner, one page per winner for the full set. */
async function rasterizeIntoPdf(elements: HTMLElement[], fileName: string): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
  ]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "in", format: "letter" });
  for (let i = 0; i < elements.length; i++) {
    const canvas = await html2canvas(elements[i], {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      // Images (the seals, the winner portrait) go through drawImage, which
      // defaults to the canvas' "low" smoothing — that is what left the fine
      // gold linework of the seals mushy.  Text is drawn as vectors either way.
      imageSmoothing: true,
      imageSmoothingQuality: "high",
    });
    if (i > 0) pdf.addPage("letter", "landscape");
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 11, 8.5);
  }
  pdf.save(fileName);
}

/** Download ONE winner's certificate (the mounted element for that
 *  winner) as its own PDF. */
export async function downloadWinnerCertificatePdf(
  certificate: HTMLElement,
  winner: CertificateWinner,
): Promise<void> {
  await waitForAssets(certificate);
  await rasterizeIntoPdf(
    [certificate],
    `Proclamation ${safeFileName(winner.position)} - ${safeFileName(winner.winnerName)}.pdf`,
  );
}

/** Download EVERY mounted certificate as ONE multi-page PDF (one
 *  landscape page per winner, in the Board's canonical order).  Returns
 *  how many pages were written. */
export async function downloadAllWinnerCertificatesPdf(): Promise<number> {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(CERTIFICATE_SELECTOR));
  if (elements.length === 0) {
    throw new Error("There are no proclaimed winners to certify yet.");
  }
  await waitForAssets(elements[0].parentElement ?? document);
  await rasterizeIntoPdf(elements, "Proclamation Certificates - All Winners.pdf");
  return elements.length;
}
