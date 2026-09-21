import { Link } from "react-router";
import { Mail, Phone, Calendar, Facebook, Github, Twitter } from "lucide-react";

export function Footer() {
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
              <a href="#" className="text-gray-400 hover:text-white transition-colors" aria-label="Facebook">
                <Facebook size={20} />
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors" aria-label="Github">
                <Github size={20} />
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors" aria-label="Twitter">
                <Twitter size={20} />
              </a>
            </div>
          </div>

          {/* Resources Section */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">Resources</h3>
            <ul className="space-y-2 text-gray-400">
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
                  Election Guidelines
                </Link>
              </li>
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
                  Forms & Documents
                </Link>
              </li>
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
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
                <Link to="/register" className="block hover:text-white transition-colors">
                  Register to Vote
                </Link>
              </li>
              <li>
                <Link to="/student/candidates" className="block hover:text-white transition-colors">
                  View Candidates
                </Link>
              </li>
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
                  Election Calendar
                </Link>
              </li>
              <li>
                <Link to="/" className="block hover:text-white transition-colors">
                  Voting Guide
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact Section */}
          <div className="space-y-4">
            <h3 className="text-white font-semibold mb-2">Contact Us</h3>
            <p className="flex items-center space-x-2 text-gray-400">
              <Mail size={16} />
              <span>voting@cnnhs.edu.ph</span>
            </p>
            <p className="flex items-center space-x-2 text-gray-400">
              <Phone size={16} />
              <span>(054) 400-0000</span>
            </p>
            <p className="flex items-center space-x-2 text-gray-400 mt-2">
              <Calendar size={16} />
              <span>Office Hours: 8:00 AM - 5:00 PM</span>
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 text-center text-gray-500">
          <p className="text-sm">
            © 2026 Camarines Norte National High School — Online Voting and Election Management System.
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