/**
 * The Q&A content shared by the staff Election Help Desk
 * (/admin/help-desk) and the public FAQ page (/faq).  One source, so the
 * two surfaces can never drift apart — the Help Desk is where staff go and
 * the FAQ page is where students land from the Resources dropdown, and both
 * must tell the same story.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export const helpDeskFaqs: FaqItem[] = [
  { q: "How do I register as a voter?", a: "Go to the Registration page and fill out the required fields. Your details (LRN, full name, birthdate, grade level, and gender) must match the Student Masterlist for automatic approval." },
  { q: "How do I apply for candidacy?", a: "Once the candidacy period is open by the Electoral Board, go to Apply for Candidacy in your student dashboard and follow the 5-step process." },
  { q: "How does biometric voting work?", a: "On your first visit to the kiosk, you will log in with your student account and register your fingerprint. On subsequent votes, you just scan your fingerprint." },
  { q: "What if I forget my password?", a: "Contact the Commissioner of Grievance or your class adviser to reset your password." },
  { q: "Can I change my vote?", a: "No. Once a vote is cast at the kiosk, it cannot be changed. Voting is final and irrevocable." },
  { q: "What if the kiosk malfunctions?", a: "Report any kiosk issue to the Election Officer at the precinct. The kiosk supports offline mode so votes are queued." },
  { q: "How do I file a complaint?", a: "Go to your Student Dashboard and use the Complaint section, or visit the Commissioner of Grievance in person." },
  { q: "When are election results published?", a: "Results are published after the voting period ends and the Chief Commissioner approves the final tally." },
];
