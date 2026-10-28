import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle, Gavel, GraduationCap, Loader2, Mail, ShieldCheck, UserRound,
} from "lucide-react";
import {
  fetchContactInformationRpc,
  type ContactInformation,
} from "../lib/supabaseData";

/** The three roles the page presents, in display order. */
const ROLE_CARDS = [
  {
    key: "chief_commissioner" as const,
    label: "Chief Commissioner",
    blurb: "Overall authority over the election and the final proclamation.",
    icon: <ShieldCheck size={22} />,
  },
  {
    key: "sslg_adviser" as const,
    label: "SSLG Adviser",
    blurb: "Oversees student enrollment and the learner government program.",
    icon: <GraduationCap size={22} />,
  },
  {
    key: "grievance_commissioner" as const,
    label: "Grievance Commissioner",
    blurb: "Receives and resolves complaints about the election.",
    icon: <Gavel size={22} />,
  },
];

/**
 * The public Contact Information page (Resources dropdown).  It reads the
 * ACTIVE officers' emails through the ungated contact_information_rpc
 * (116) — the only client-readable path to adminprofiles since 038.
 */
export default function ContactInformationPage() {
  const [contacts, setContacts] = useState<ContactInformation | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasError(false);

    fetchContactInformationRpc()
      .then((result) => {
        if (active) setContacts(result);
      })
      .catch(() => {
        if (active) {
          setContacts(null);
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center" role="status">
            <Loader2 className="animate-spin mb-4" size={36} style={{ color: "#5C0102" }} />
            <p className="text-gray-600">Loading contact information...</p>
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <h1 className="text-2xl text-gray-900 mb-2">Unable to Load Contact Information</h1>
            <p className="text-gray-500 max-w-md">
              We could not retrieve the officers' contact details. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden mb-8 text-white"
              style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
            >
              <div className="px-6 py-8 sm:px-10 sm:py-10">
                <h1 className="text-3xl sm:text-4xl font-semibold flex items-center gap-3">
                  <Mail size={32} className="flex-shrink-0" />
                  <span>Contact Information</span>
                </h1>
                <p className="text-white/75 mt-2">
                  Reach the right officer for your concern during the SSLG
                  election — by email.
                </p>
              </div>
            </motion.div>

            {/* One card per role */}
            <div className="space-y-4 mb-8">
              {ROLE_CARDS.map((role) => {
                const entry = contacts?.[role.key] ?? null;
                return (
                  <div
                    key={role.key}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-6 flex items-start gap-4"
                  >
                    <div
                      className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0"
                      style={{ color: "#5C0102" }}
                    >
                      {role.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-gray-900 font-medium">{role.label}</h2>
                      <p className="text-gray-500 text-xs mt-0.5">{role.blurb}</p>
                      {entry ? (
                        <a
                          href={`mailto:${entry.email}`}
                          className="mt-2 inline-flex items-center gap-1.5 text-sm hover:underline"
                          style={{ color: "#5C0102" }}
                        >
                          <Mail size={13} /> {entry.email}
                        </a>
                      ) : (
                        <p className="mt-2 text-sm text-gray-400 flex items-center gap-1.5">
                          <UserRound size={13} /> The position is currently vacant.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-center text-gray-500 text-sm">
              Looking for a quick answer first? Check the{" "}
              <Link to="/faq" className="font-medium hover:underline" style={{ color: "#5C0102" }}>
                Frequently Asked Questions
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
