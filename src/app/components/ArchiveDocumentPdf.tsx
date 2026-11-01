/**
 * ArchiveDocumentPdf — the printable layout behind the Candidates Archived
 * Document download.  AdminArchive mounts `ArchivePdfDocument` off-screen
 * only while a download is being generated; `downloadArchiveDocumentPdf`
 * then rasterizes it one letter page per section (html2canvas-pro + jsPDF,
 * lazily imported — the same pattern as the EAF download and the
 * proclamation certificates; html2canvas-pro is required because Tailwind 4's
 * palette emits oklch() colors).
 *
 * One candidate = one PDF with up to four pages:
 *   1. Candidate Information — identity block + the submitted details grid.
 *   2. Introductory Profile — the candidate's own answers.
 *   3. EAF Front — the uploaded front photo of the Election Application Form,
 *   4. EAF Back — the uploaded back photo, each on its own full letter page
 *      (a photo page is skipped when that side was not uploaded).
 */
import type { CSSProperties, ReactNode } from "react";
import type { Candidate } from "../context/AppContext";

// ── Shared page chrome ─────────────────────────────────────────────────

const LETTER_PAGE: CSSProperties = {
  width: "8.5in",
  height: "11in",
  backgroundColor: "#ffffff",
  overflow: "hidden",
};

/** One letter-portrait page with the archive header band on top. */
function ArchivePdfPage({ section, children }: { section: string; children: ReactNode }) {
  return (
    <div
      data-archive-pdf-page
      className="bg-white text-gray-900 flex flex-col"
      style={{ ...LETTER_PAGE, padding: "0.55in" }}
    >
      <div className="flex items-end justify-between border-b-2 pb-2 mb-4" style={{ borderColor: "#5C0102" }}>
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-gray-400">
            Candidates Archived Document
          </div>
          <div className="text-sm font-bold" style={{ color: "#5C0102" }}>{section}</div>
        </div>
        <div className="text-[9px] text-gray-400">CNNHS — SSLG Commission on Elections</div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}

/** Icon-free status pill — rasterizes more predictably than the on-screen
 *  badge and reads the same. */
function PdfStatusPill({ status }: { status: Candidate["status"] }) {
  const styles: Record<Candidate["status"], string> = {
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    ongoingSubmission: "bg-blue-100 text-blue-700",
    pending: "bg-amber-100 text-amber-700",
  };
  const labels: Record<Candidate["status"], string> = {
    approved: "Approved",
    rejected: "Rejected",
    ongoingSubmission: "Ongoing Submission",
    pending: "Pending",
  };
  return (
    <span className={`inline-block text-[10px] px-2.5 py-1 rounded-full font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ── Page 1: Candidate Information ──────────────────────────────────────

function ArchiveCandidateInfoPage({ candidate }: { candidate: Candidate }) {
  return (
    <ArchivePdfPage section="Candidate Information">
      <div className="flex items-center gap-4">
        {candidate.picture ? (
          <img
            src={candidate.picture}
            alt=""
            className="w-20 h-20 rounded-full object-cover border-4 border-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-2xl font-bold text-gray-500 flex-shrink-0">
            {candidate.givenName.charAt(0)}
          </div>
        )}
        <div>
          <div className="text-lg font-semibold">
            {candidate.givenName} {candidate.middleName} {candidate.surname}
          </div>
          <div className="text-sm text-gray-600">{candidate.position}</div>
          <div className="text-xs text-gray-400">{candidate.partyAffiliation || "Independent"}</div>
          <div className="mt-1.5">
            <PdfStatusPill status={candidate.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-5">
        {[
          ["Grade Level", candidate.gradeLevel],
          ["Gender", candidate.gender],
          ["Age", `${candidate.age} years old`],
          ["Date of Birth", candidate.dateOfBirth],
          ["Email", candidate.email],
          ["Mobile", candidate.mobileNumber],
          ["Address", candidate.homeAddress],
          ["Date Submitted", candidate.submittedAt],
        ].map(([label, val]) => (
          <div key={label} className="bg-gray-50 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</div>
            <div className="text-xs font-medium break-all">{val}</div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-3 border-t border-gray-100 text-[9px] text-gray-400">
        Generated from the archived candidacy record · {candidate.submittedAt}
      </div>
    </ArchivePdfPage>
  );
}

// ── Page 2: Introductory Profile (the candidate's own answers) ─────────

function ArchiveIntroductoryProfilePage({ candidate }: { candidate: Candidate }) {
  const profile = candidate.leadershipProfile;
  return (
    <ArchivePdfPage section="Introductory Profile">
      {profile ? (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              What qualities do you possess as an inspiring student leader?
            </div>
            <div className="text-xs whitespace-pre-wrap leading-relaxed">{profile.qualities}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              Organizational skills applicable to you
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {profile.skills.map((skill) => (
                <span key={skill} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  {skill}
                </span>
              ))}
            </div>
            <div className="text-xs whitespace-pre-wrap leading-relaxed">{profile.skillsExplanation}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              Your vision of the Learner Government in 3 years' time
            </div>
            <div className="text-xs whitespace-pre-wrap leading-relaxed">{profile.threeYearVision}</div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-400">No introductory profile on file for this candidate.</p>
      )}
    </ArchivePdfPage>
  );
}

// ── EAF photo pages (one full letter page per uploaded photo) ──────────

function ArchiveEafPhotoPage({ side, src }: { side: "Front" | "Back"; src: string }) {
  return (
    <ArchivePdfPage section={`EAF ${side} — Election Application Form`}>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <img
          src={src}
          alt={`EAF ${side}`}
          className="max-h-full max-w-full object-contain rounded border border-gray-200"
        />
      </div>
    </ArchivePdfPage>
  );
}

/** The full off-screen document: one page per section, plus one full page
 *  per uploaded EAF photo (front/back) — a photo page is skipped when that
 *  side was not uploaded. */
export function ArchivePdfDocument({ candidate }: { candidate: Candidate }) {
  return (
    <>
      <ArchiveCandidateInfoPage candidate={candidate} />
      <ArchiveIntroductoryProfilePage candidate={candidate} />
      {candidate.eafFrontImage && (
        <ArchiveEafPhotoPage side="Front" src={candidate.eafFrontImage} />
      )}
      {candidate.eafBackImage && (
        <ArchiveEafPhotoPage side="Back" src={candidate.eafBackImage} />
      )}
    </>
  );
}

// ── PDF generation (html2canvas-pro + jsPDF, lazily imported) ──────────

/** Strip Windows-illegal filename characters (same rule as the certificates). */
function safeFileName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, "").trim();
}

/** Download file name, matching the archive row title. */
export function archivePdfFileName(candidate: Candidate): string {
  return `${safeFileName(`Application - ${candidate.givenName} ${candidate.surname}`)}.pdf`;
}

/** Give a stalled image URL a bounded wait — the rasterizer captures whatever
 *  is painted when this resolves. */
const PDF_IMAGE_TIMEOUT_MS = 5000;

/** Wait until every image inside the mount has finished (or failed to) load. */
async function waitForPdfImages(root: ParentNode): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) => {
      if (img.complete) return Promise.resolve();
      return Promise.race([
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, PDF_IMAGE_TIMEOUT_MS)),
      ]);
    }),
  );
}

/** Rasterize each `[data-archive-pdf-page]` inside `mount` into one
 *  letter-portrait PDF page and trigger the browser download. */
export async function downloadArchiveDocumentPdf(mount: HTMLElement, fileName: string): Promise<void> {
  await waitForPdfImages(mount);
  const pages = Array.from(mount.querySelectorAll<HTMLElement>("[data-archive-pdf-page]"));
  if (pages.length === 0) {
    throw new Error("Nothing to include in the PDF download.");
  }
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
  ]);
  const pdf = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    if (i > 0) pdf.addPage("letter", "portrait");
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 8.5, 11);
  }
  pdf.save(fileName);
}
