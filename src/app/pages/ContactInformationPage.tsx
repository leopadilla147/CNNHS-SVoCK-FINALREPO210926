import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Gavel,
  GraduationCap,
  HelpCircle,
  Loader2,
  Mail,
  School,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  fetchContactInformationRpc,
  type ContactInformation,
} from "../lib/supabaseData";
import cnnhsLogo from "../assets/CNNHS_Logo1.png";

/** The three roles the page presents, in display order. */
const ROLE_CARDS = [
  {
    key: "chief_commissioner" as const,
    label: "Chief Commissioner",
    blurb: "Overall authority over the election and the final proclamation.",
    badge: "COMEA Leadership",
    icon: <ShieldCheck size={24} />,
  },
  {
    key: "sslg_adviser" as const,
    label: "SSLG Adviser",
    blurb: "Oversees student enrollment and the learner government program.",
    badge: "Student Affairs",
    icon: <GraduationCap size={24} />,
  },
  {
    key: "grievance_commissioner" as const,
    label: "Grievance Commissioner",
    blurb: "Receives and resolves complaints about the election.",
    badge: "Dispute & Resolutions",
    icon: <Gavel size={24} />,
  },
];

const OFFICIAL_SCHOOL_EMAIL = "cnnhsonline@gmail.com";

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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center py-28 text-center"
            role="status"
          >
            <div className="relative mb-5">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-inner"
                style={{ backgroundColor: "rgba(92, 1, 2, 0.08)" }}
              >
                <Loader2 className="animate-spin" size={32} style={{ color: "#5C0102" }} />
              </div>
            </div>
            <p className="text-gray-900 font-medium text-base">Loading contact information...</p>
            <p className="text-gray-500 text-sm mt-1">Retrieving official electoral board channels</p>
          </div>
        ) : hasError ? (
          <div
            className="bg-white rounded-3xl border border-red-100 shadow-sm p-8 sm:p-14 max-w-xl mx-auto text-center"
            role="alert"
          >
            <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-5 border border-red-100">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-2.5">
              Unable to Load Contact Information
            </h1>
            <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
              We could not retrieve the officers' contact details. Please try again later.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center justify-center px-6 py-2.5 rounded-xl text-white text-sm font-medium transition-all duration-200 hover:opacity-90 shadow-sm"
              style={{ backgroundColor: "#5C0102" }}
            >
              Return Home
            </Link>
          </div>
        ) : (
          <>
            {/* ── Hero Banner ───────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-3xl overflow-hidden mb-8 text-white shadow-xl"
              style={{
                background: "linear-gradient(135deg, #5C0102 0%, #8B0103 60%, #6B0203 100%)",
              }}
            >
              {/* Decorative radial glows */}
              <div
                className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-[0.08]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />
              <div
                className="pointer-events-none absolute -bottom-24 -left-20 w-80 h-80 rounded-full opacity-[0.05]"
                style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }}
              />

              <div className="relative px-6 py-8 sm:px-10 sm:py-12">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                  {/* School Seal */}
                  <div className="w-18 h-18 sm:w-22 sm:h-22 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center flex-shrink-0 shadow-lg p-2.5">
                    <img
                      src={cnnhsLogo}
                      alt=""
                      className="w-13 h-13 sm:w-16 sm:h-16 rounded-full object-contain"
                    />
                  </div>

                  <div className="text-center sm:text-left">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15 text-xs font-medium tracking-wider uppercase mb-3.5 text-white/90">
                      <Mail size={13} />
                      Official Directory
                    </div>
                    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight">
                      Contact Information
                    </h1>
                    <p className="text-white/75 mt-2.5 text-sm sm:text-base max-w-xl leading-relaxed">
                      Reach the right officer for your concern during the SSLG election — by email.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── Official School Inquiries Card ─────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="group relative bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-7 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 overflow-hidden mb-5"
            >
              {/* Top gradient accent */}
              <div
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
                <div className="flex items-start gap-4 sm:gap-5 min-w-0">
                  <div
                    className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm text-white"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    <School size={24} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900 group-hover:text-[#5C0102] transition-colors duration-200">
                        Official School Inquiries
                      </h2>
                      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 uppercase tracking-wider">
                        Camarines Norte NHS
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs sm:text-sm leading-relaxed max-w-lg">
                      Official school inbox for institutional communications, student verification, and public inquiries.
                    </p>
                  </div>
                </div>

                <div className="sm:self-center flex-shrink-0 pt-2 sm:pt-0 pl-17 sm:pl-0">
                  <div
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold pointer-events-none cursor-default select-text"
                    style={{
                      backgroundColor: "rgba(92, 1, 2, 0.06)",
                      color: "#5C0102",
                      border: "1px solid rgba(92, 1, 2, 0.15)",
                    }}
                  >
                    <Mail size={15} className="flex-shrink-0" />
                    <span>{OFFICIAL_SCHOOL_EMAIL}</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* ── Role Cards List ───────────────────────────────── */}
            <div className="space-y-5 mb-10">
              {ROLE_CARDS.map((role, index) => {
                const entry = contacts?.[role.key] ?? null;
                return (
                  <motion.div
                    key={role.key}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: (index + 1) * 0.08 }}
                    className="group relative bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-7 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 overflow-hidden"
                  >
                    {/* Hover accent gradient bar */}
                    <div
                      className="absolute inset-x-0 bottom-0 h-1 rounded-b-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                      style={{ background: "linear-gradient(90deg, #5C0102, #8B0103)" }}
                    />

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
                      <div className="flex items-start gap-4 sm:gap-5 min-w-0">
                        {/* Role Icon Box */}
                        <div
                          className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-105 shadow-sm"
                          style={{
                            backgroundColor: "rgba(92, 1, 2, 0.06)",
                            color: "#5C0102",
                          }}
                        >
                          {role.icon}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 group-hover:text-[#5C0102] transition-colors duration-200">
                              {role.label}
                            </h2>
                            <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 uppercase tracking-wider">
                              {role.badge}
                            </span>
                          </div>
                          <p className="text-gray-500 text-xs sm:text-sm leading-relaxed max-w-lg">
                            {role.blurb}
                          </p>
                        </div>
                      </div>

                      {/* Action Area (Non-clickable Display Area) */}
                      <div className="sm:self-center flex-shrink-0 pt-2 sm:pt-0 pl-17 sm:pl-0">
                        {entry ? (
                          <a
                            href={`mailto:${entry.email}`}
                            onClick={(e) => e.preventDefault()}
                            tabIndex={-1}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold pointer-events-none cursor-default select-text"
                            style={{
                              backgroundColor: "rgba(92, 1, 2, 0.06)",
                              color: "#5C0102",
                              border: "1px solid rgba(92, 1, 2, 0.15)",
                            }}
                          >
                            <Mail size={15} className="flex-shrink-0" />
                            <span>{entry.email}</span>
                          </a>
                        ) : (
                          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm text-gray-400 bg-gray-50 border border-gray-100 pointer-events-none cursor-default">
                            <UserRound size={14} className="text-gray-400" />
                            <span>The position is currently vacant.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* ── FAQ Guidance Callout Card ──────────────────────── */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
              className="bg-white rounded-2xl sm:rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-7 text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "rgba(92, 1, 2, 0.06)", color: "#5C0102" }}
                >
                  <HelpCircle size={20} />
                </div>
                <p className="text-gray-600 text-sm">
                  Looking for a quick answer first? Check the{" "}
                  <Link
                    to="/faq"
                    className="font-semibold hover:underline"
                    style={{ color: "#5C0102" }}
                  >
                    Frequently Asked Questions
                  </Link>
                  .
                </p>
              </div>

              <Link
                to="/faq"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-white transition-opacity hover:opacity-90 flex-shrink-0 shadow-sm"
                style={{ backgroundColor: "#5C0102" }}
              >
                Go to FAQ
                <ArrowRight size={13} />
              </Link>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
