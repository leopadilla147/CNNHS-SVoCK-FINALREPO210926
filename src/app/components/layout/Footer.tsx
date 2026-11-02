import { Link } from "react-router";
import { Mail, MapPin, Clock, Facebook } from "lucide-react";
import { useApp, defaultHomepageSettings, formatOfficeTime } from "../../context/AppContext";
import { getCalendarHref } from "./roleNav";

export function Footer() {
  // 115: the Contact Us block is Chief-editable content (Homepage Setting).
  // The context falls back to the shipped defaults while the row loads (or
  // when Supabase is not configured).  The destructure default also covers
  // flat test stubs that omit the key entirely.
  const { currentUser, homepageSettings = defaultHomepageSettings } = useApp();
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(homepageSettings.location)}`;

  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* About Section */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">About CNNHS Voting System</h3>
            <p className="text-gray-400">
              Secure online election platform for Camarines Norte National High School
              Supreme Student Learner Government elections.
            </p>
            <div className="flex space-x-4 mt-4">
              <a
                href="https://www.facebook.com/CamHighCN"
                target="_blank"
                rel="noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Facebook"
              >
                <Facebook size={20} />
              </a>
            </div>
          </div>

          {/* Resources Section */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">Resources</h3>
            <ul className="space-y-2 text-gray-400">
              <li>
                <Link to="/guidelines" className="block hover:text-white transition-colors">
                  Election Guidelines
                </Link>
              </li>
              <li>
                <Link to={getCalendarHref(currentUser)} className="block hover:text-white transition-colors">
                  Election Calendar
                </Link>
              </li>
              <li>
                <Link to="/faq" className="block hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link to="/contact" className="block hover:text-white transition-colors">
                  Contact Information
                </Link>
              </li>
            </ul>
          </div>

          {/* Quick Links Section */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">Quick Links</h3>
            <ul className="space-y-2 text-gray-400">
              <li>
                <Link to="/about" className="block hover:text-white transition-colors">
                  About CNNHS
                </Link>
              </li>
              {/* Student Registration — guests only, matching the header tab */}
              {!currentUser && (
                <li>
                  <Link to="/register" className="block hover:text-white transition-colors">
                    Student Registration
                  </Link>
                </li>
              )}
              <li>
                <Link to="/current-election" className="block hover:text-white transition-colors">
                  Current Election
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact Section — content editable under Homepage Setting (115) */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">Contact Us</h3>
            <p className="flex items-center space-x-2 text-gray-400">
              <Mail size={16} />
              <a
                href={`mailto:${
                  homepageSettings.contactEmail && homepageSettings.contactEmail !== "cnnhs@gmail.com"
                    ? homepageSettings.contactEmail
                    : "cnnhsonline@gmail.com"
                }`}
                className="hover:text-white transition-colors"
              >
                {homepageSettings.contactEmail && homepageSettings.contactEmail !== "cnnhs@gmail.com"
                  ? homepageSettings.contactEmail
                  : "cnnhsonline@gmail.com"}
              </a>
            </p>
            <p className="flex items-start space-x-2 text-gray-400">
              <MapPin size={16} className="mt-0.5 flex-shrink-0" />
              <a
                href={mapsLink}
                target="_blank"
                rel="noreferrer"
                title="View on Google Maps"
                className="hover:text-white transition-colors"
              >
                {homepageSettings.location}
              </a>
            </p>
            <p className="flex items-center space-x-2 text-gray-400 mt-2">
              <Clock size={16} />
              <span>
                Office Hours: {formatOfficeTime(homepageSettings.officeHoursStart)} - {formatOfficeTime(homepageSettings.officeHoursEnd)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 text-center text-gray-500">
          <p className="text-sm">
            © 2026 Camarines Norte National High School — Election Management System.
            All rights reserved.
          </p>
          <p className="text-xs mt-2">
            Developed for CNNHS Student Elections in compliance with DepEd LGP Guidelines (FO-2023-04-003)
          </p>
        </div>
      </div>
    </footer>
  );
}