import type { ReactNode } from "react";
import { Candidate, Student } from "../context/AppContext";
import depedSealUrl from "../assets/eaf-deped-seal.png";

interface EAFPreviewDocumentProps {
  candidate: Candidate;
  student: Student;
  partyName?: string;
  onPrint?: () => void;
}

const LineValue = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <span className={`inline-block border-b border-black min-h-[14px] px-1 align-bottom leading-none ${className}`}>
    {children || "\u00a0"}
  </span>
);

const SignatureBlock = ({ label, sublabel, value }: { label: string; sublabel?: string; value?: string }) => (
  <div className="text-center">
    <div className="border-b border-black h-5 mb-0.5 flex items-end justify-center px-1 text-[9px]">{value || ""}</div>
    <div className="text-[8px] uppercase leading-tight">{label}</div>
    {sublabel && <div className="text-[8px] leading-tight">{sublabel}</div>}
  </div>
);

const CheckCell = ({ label }: { label: string }) => (
  <div className="flex items-center justify-center gap-1 font-bold">
    <span className="inline-block w-3 h-3 border border-black" />
    {label}
  </div>
);

export function EAFPreviewDocument({ candidate, student, partyName, onPrint }: EAFPreviewDocumentProps) {
  const fullName = `${candidate.surname}, ${candidate.givenName} ${candidate.middleName ? candidate.middleName + " " : ""}${candidate.extensionName || ""}`.trim();
  const positionAndParty = `${candidate.position} - ${partyName || candidate.partyAffiliation || "Independent"}`;

  return (
    <div className="bg-white rounded-lg shadow-sm text-black print:shadow-none print:rounded-none" style={{ fontFamily: "Times New Roman, serif" }}>
      <div
        data-eaf-document="true"
        className="eaf-preview mx-auto w-[816px] min-h-[1056px] bg-white p-8 text-[10px] leading-tight print:w-[8.5in] print:min-h-[11in] print:p-[0.32in]"
      >
        <header className="grid grid-cols-[58px_1fr_58px] items-center gap-3 mb-2">
          <img src={depedSealUrl} alt="Department of Education seal" className="w-[58px] h-[58px] object-contain" />
          <div className="text-center leading-tight">
            <div>Republic of the Philippines</div>
            <div>Department of Education</div>
            <div>Region V- Bicol</div>
            <div className="font-bold">SCHOOLS DIVISION OFFICE OF CAMARINES NORTE</div>
            <div className="font-bold">CAMARINES NORTE NATIONAL HIGH SCHOOL</div>
            <div>Camambugan, Daet, Camarines Norte</div>
          </div>
          <div />
        </header>

        <div className="mb-2 text-[10px]">
          <strong>Enclosure No. 1:</strong> Election Application Form (EAF) of Student Organization
        </div>

        <h2 className="text-center text-[13px] font-bold uppercase tracking-wide mb-2">
          ELECTION APPLICATION FORM (EAF) OF STUDENT ORGANIZATION
        </h2>

        <div className="grid grid-cols-[1fr_88px] gap-4 mb-3 items-start">
          <p className="text-justify indent-7">
            The Student Organization lives in the ideals, principles, and practices of participatory democracy.
            It represents the organization and ready to steer the student body towards the fulfillment of its goal
            by promoting its rights and welfare. As a student leader, this Certificate of Candidacy is a statement
            of your purest intention and understanding in a position you are applying for. By signing and filling
            out this form, I understand that my term will officially start by April 2026, if I have been officially elected.
          </p>
          <div className="w-[88px] h-[88px] border border-black flex items-center justify-center text-center text-[9px] leading-tight">
            {candidate.picture ? (
              <img src={candidate.picture} alt="2x2" className="h-full w-full object-cover" />
            ) : (
              <span>Place your<br />2X2 Picture Here</span>
            )}
          </div>
        </div>

        <section className="mb-3">
          <h3 className="font-bold mb-1">I. PERSONAL DETAILS</h3>
          <div className="space-y-1">
            <div>
              Student's Name: <LineValue className="w-[430px]">{fullName}</LineValue>
            </div>
            <div className="pl-24 text-[8px]">
              (Surname, Given Name, Middle Name, & Extension Name e.g., Jr., I., II...)
            </div>
            <div>
              Current Grade Level: <LineValue className="w-[330px]">{candidate.gradeLevel}</LineValue>
            </div>
            <div>
              Desired Position & Organization: <LineValue className="w-[300px]">{positionAndParty}</LineValue>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Gender: <LineValue className="w-20">{candidate.gender}</LineValue></span>
              <span>Age: <LineValue className="w-10">{candidate.age}</LineValue></span>
              <span>Date of Birth: <LineValue className="w-36">{candidate.dateOfBirth}</LineValue></span>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span>Email Address: <LineValue className="w-40">{candidate.email}</LineValue></span>
              <span>Mobile No.: <LineValue className="w-28">{candidate.mobileNumber}</LineValue></span>
              <span>Landline: <LineValue className="w-20">{candidate.landline || ""}</LineValue></span>
            </div>
            <div>
              Home Address: <LineValue className="w-[455px]">{candidate.homeAddress}</LineValue>
            </div>
            <div>
              LRN: <LineValue className="w-44">{student.lrn}</LineValue>
            </div>
          </div>
        </section>

        <section className="mb-3">
          <h3 className="font-bold mb-1">II. Student's Status</h3>
          <div className="border border-black">
            <div className="grid grid-cols-[1fr_52px_52px] border-b border-black">
              <div className="p-1.5 border-r border-black">Has good academic standing and has no failing grades in all subject areas?</div>
              <div className="p-1 border-r border-black"><CheckCell label="YES" /></div>
              <div className="p-1"><CheckCell label="NO" /></div>
            </div>
            <div className="p-1.5">
              <div className="mb-1">Attested by:</div>
              <div className="grid grid-cols-[1fr_95px] gap-6">
                <SignatureBlock label="Class Adviser Name & Signature" />
                <SignatureBlock label="Date" />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_52px_52px] border-y border-black">
              <div className="p-1.5 border-r border-black">Is of Good Moral Character?</div>
              <div className="p-1 border-r border-black"><CheckCell label="YES" /></div>
              <div className="p-1"><CheckCell label="NO" /></div>
            </div>
            <div className="p-1.5">
              <div className="mb-1">Attested by:</div>
              <div className="grid grid-cols-[1fr_95px] gap-6">
                <SignatureBlock label="EsP/Guidance Coordinator" sublabel="Name & Signature" />
                <SignatureBlock label="Date" />
              </div>
            </div>
          </div>
        </section>

        <section className="mb-3">
          <h3 className="font-bold mb-1">III. Parent Consent</h3>
          <p className="indent-7 mb-2">
            I, <LineValue className="w-56">{candidate.parentGuardianName}</LineValue> as a parent/guardian will support my son/daughter to the best of my ability
            as he/she commits to the Student Organization.
          </p>
          <p className="indent-7 mb-4">
            I agree and understand the commitment of my son/daughter and will support his/her endeavor to the Student Organization.
          </p>
          <div className="grid grid-cols-[1fr_145px] gap-14 mb-3">
            <SignatureBlock label="Name and Signature of the Parent/Guardian" value={candidate.parentGuardianName} />
            <div className="text-center">
              <div className="border-b border-black h-5 mb-0.5">{candidate.parentGuardianContact}</div>
              <div className="text-[8px] uppercase leading-tight">Contact Number</div>
            </div>
          </div>
          <p className="indent-7 mb-1">I am filing this Election Application Form of Student Organization for SY 2026-2027.</p>
          <p className="indent-7">I hereby certify that the facts stated herein are true and correct to the best of my knowledge.</p>
        </section>

        <div className="grid grid-cols-2 gap-14 mt-4">
          <div>
            <div className="mb-5">Verified by:</div>
            <SignatureBlock label="FULL NAME OF THE AUTHORITY" sublabel="Screening and Validation Commissioner" />
            <div className="mt-2">Date: <LineValue className="w-32" /></div>
          </div>
          <div>
            <div className="mb-5">Approved by:</div>
            <SignatureBlock label="FULL NAME OF THE SCHOOL HEAD" sublabel="Youth COMEA Chief Commissioner" />
            <div className="mt-2">Date: <LineValue className="w-32" /></div>
          </div>
        </div>

        <div className="mt-3 text-[8px] text-gray-500 print:hidden">
          File name: {candidate.givenName}-{candidate.surname}-EAF
        </div>
      </div>

      {/* Page 2 – Leadership Capsule */}
      <div
        data-eaf-page2="true"
        className="eaf-preview mx-auto w-[816px] min-h-[1056px] bg-white p-8 text-[10px] leading-tight print:w-[8.5in] print:min-h-[11in] print:p-[0.32in] print:page-break-before:always"
        style={{ fontFamily: "Times New Roman, serif" }}
      >
        <header className="grid grid-cols-[58px_1fr_58px] items-center gap-3 mb-2">
          <img src={depedSealUrl} alt="Department of Education seal" className="w-[58px] h-[58px] object-contain" />
          <div className="text-center leading-tight">
            <div>Republic of the Philippines</div>
            <div>Department of Education</div>
            <div>Region V- Bicol</div>
            <div className="font-bold">SCHOOLS DIVISION OFFICE OF CAMARINES NORTE</div>
            <div className="font-bold">CAMARINES NORTE NATIONAL HIGH SCHOOL</div>
            <div>Camambugan, Daet, Camarines Norte</div>
          </div>
          <div className="text-[8px] text-right">Back Page</div>
        </header>

        <h2 className="text-center text-[13px] font-bold uppercase tracking-wide mb-4">
          IV. LEADERSHIP CAPSULE
        </h2>

        <section className="mb-4">
          <h3 className="font-bold mb-2">Guide Question: What are your qualities that you believe can make a great leader?</h3>
          <p className="text-justify indent-7 text-[10px] leading-relaxed">
            {candidate.leadershipProfile?.qualities || "No answer provided."}
          </p>
        </section>

        <section className="mb-4">
          <h3 className="font-bold mb-3">SSLG/YES-O Projects and Programs per Core Value</h3>
          <div className="space-y-4">
            {([
              { key: "makaDiyos" as const, label: "Maka-Diyos", projectKey: "makaDiyosProject" as const, descKey: "makaDiyosDescription" as const },
              { key: "makaTao" as const, label: "Maka-Tao", projectKey: "makaTaoProject" as const, descKey: "makaTaoDescription" as const },
              { key: "makakalikasan" as const, label: "Makakalikasan", projectKey: "makakalikasanProject" as const, descKey: "makakalikasanDescription" as const },
              { key: "makabansa" as const, label: "Makabansa", projectKey: "makabansaProject" as const, descKey: "makabansaDescription" as const },
            ]).map(({ key, label, projectKey, descKey }) => {
              const lp = candidate.leadershipProfile;
              const project = lp?.[projectKey];
              const description = lp?.[descKey];
              return (
                <div key={key} className="border border-black p-3">
                  <div className="font-bold text-[10px] mb-1 uppercase">{label}</div>
                  <div className="mb-1">
                    <span className="font-semibold">Project/Program:</span>{project ? ` ${project}` : " N/A"}
                  </div>
                  <div className="text-justify indent-5">
                    <span className="font-semibold">Description:</span>{description ? ` ${description}` : " N/A"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-6 text-[8px] text-gray-500 text-center">
          Leadership Capsule — Page 2 of 2 &middot; {candidate.givenName} {candidate.surname}
        </div>
      </div>

      {onPrint && (
        <div className="px-10 pb-6 flex justify-end print:hidden">
          <button
            onClick={onPrint}
            className="px-4 py-2 bg-[#5C0102] text-white rounded-lg text-sm hover:opacity-90"
          >
            Print EAF
          </button>
        </div>
      )}
    </div>
  );
}
