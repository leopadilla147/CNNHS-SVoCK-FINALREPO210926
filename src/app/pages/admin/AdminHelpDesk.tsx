import { useState } from "react";
import { motion } from "motion/react";
import { HelpCircle, Search, ChevronDown, ChevronRight, MessageCircle, Mail, Phone } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { helpDeskFaqs as faqItems } from "../../lib/helpDeskFaqs";

export default function AdminHelpDesk() {
  const [search, setSearch] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const filtered = faqItems.filter((item) =>
    item.q.toLowerCase().includes(search.toLowerCase()) ||
    item.a.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-gray-900 mb-1">Election Help Desk</h1>
        <p className="text-gray-500 text-sm">Frequently asked questions and assistance for students and voters.</p>
      </motion.div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search FAQ..."
            className="w-full bg-transparent outline-none text-sm"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100 mb-6">
        {filtered.map((item, i) => (
          <div key={i}>
            <button
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-900">{item.q}</span>
              {openIndex === i ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
            </button>
            {openIndex === i && (
              <div className="px-4 pb-4 text-sm text-gray-600">{item.a}</div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h3 className="text-gray-900 text-sm flex items-center gap-2 mb-4">
          <MessageCircle size={16} style={{ color: "#5C0102" }} /> Need More Help?
        </h3>
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2"><Mail size={14} /> grievance@cnnhs.edu</div>
          <div className="flex items-center gap-2"><Phone size={14} /> (054) 123-4567</div>
          <div className="flex items-center gap-2"><MessageCircle size={14} /> Visit the Guidance Office</div>
        </div>
      </div>
    </div>
  );
}
