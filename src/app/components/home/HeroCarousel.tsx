import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../ui/utils";
import { useApp } from "../../context/AppContext";
import { getCalendarHref } from "../layout/roleNav";
import cnnhsHero from "../../assets/CNNHS1.jpg";
import cnnhsLogo from "../../assets/CNNHS_Logo1.png";

/**
 * The homepage hero slider — four rotating slides over the campus photo,
 * each with its own maroon tint, headline, description, and call-to-action
 * buttons.  Auto-advances every 6 seconds (pausing on hover/focus), with
 * prev/next arrows and dot indicators; `prefers-reduced-motion` swaps the
 * directional slide for a plain fade.
 */

/** Auto-advance delay for the hero slider (ms). */
const AUTOPLAY_MS = 6000;

interface HeroCta {
  label: string;
  to: string;
  /** Filled white (true) vs white-outline (false) — the original hero button styles. */
  primary?: boolean;
  /** Pre-login doors only: hidden once any user is signed in. */
  loggedOutOnly?: boolean;
  /** Election Calendar door — resolves to the signed-in user's own portal
   *  calendar (guests keep the public page) via getCalendarHref. */
  calendarCta?: boolean;
}

interface HeroSlide {
  id: string;
  eyebrow: string;
  /** The Welcome slide carries the two-line school name; plain strings elsewhere. */
  title: ReactNode;
  description: string;
  /** Per-slide maroon tint so each slide reads distinctly over the shared photo. */
  tint: string;
  showLogo?: boolean;
  ctas: HeroCta[];
}

const SLIDES: HeroSlide[] = [
  {
    id: "welcome",
    eyebrow: "Welcome to CNNHS",
    showLogo: true,
    title: (
      <>
        Camarines Norte
        <br />
        National High School
      </>
    ),
    description: "Secure Online Elections for CNNHS Supreme Student Learner Government",
    tint: "linear-gradient(135deg, #5C0102 0%, #8B0103 50%, #3D0001 100%)",
    ctas: [{ label: "About CNNHS", to: "/about", primary: true }],
  },
  {
    id: "registration",
    eyebrow: "Student Registration",
    title: "Be Heard. One Scan, One Secure Vote.",
    description:
      "Create your student account to join this school year's SSLG elections — verified against the school masterlist and ready for the biometric kiosks.",
    tint: "linear-gradient(135deg, #3D0001 0%, #5C0102 55%, #8B0103 100%)",
    ctas: [
      { label: "Student Registration", to: "/register", primary: true, loggedOutOnly: true },
      { label: "Login", to: "/login", loggedOutOnly: true },
    ],
  },
  {
    id: "election",
    eyebrow: "The Election",
    title: "This Year's Election",
    description:
      "Follow every stage — candidacy, campaign, fingerprint registration, and voting day — in one place.",
    tint: "linear-gradient(150deg, #6B0203 0%, #8B0103 45%, #2B0001 100%)",
    ctas: [
      { label: "Current Election", to: "/current-election", primary: true },
      { label: "Election Calendar", to: "/calendar", calendarCta: true },
    ],
  },
  {
    id: "results",
    eyebrow: "Election Results",
    title: "The Verdict",
    description: "Official, board-certified results — see the latest standings or revisit past elections.",
    tint: "linear-gradient(135deg, #2B0001 0%, #5C0102 55%, #7A0103 100%)",
    ctas: [
      { label: "Official Results", to: "/official-results", primary: true },
      { label: "Past Elections", to: "/past-elections" },
    ],
  },
];

/** Directional slide — a gentle 60px push with a crossfade. */
const slideVariants = {
  enter: (direction: number) => ({ x: direction >= 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction >= 0 ? -60 : 60, opacity: 0 }),
};

/** Reduced-motion fallback — plain crossfade, no horizontal movement. */
const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

export function HeroCarousel() {
  const { currentUser } = useApp();
  const reduceMotion = useReducedMotion();
  const [[index, direction], setSlide] = useState<[number, number]>([0, 0]);
  const [paused, setPaused] = useState(false);

  const slide = SLIDES[index];
  // Pre-login doors (Student Registration) disappear once anyone is signed in;
  // the slide itself stays in rotation with just its message.
  const visibleCtas = slide.ctas.filter((cta) => !(cta.loggedOutOnly && currentUser));

  const goNext = () => setSlide(([i]) => [(i + 1) % SLIDES.length, 1]);
  const goPrev = () => setSlide(([i]) => [(i - 1 + SLIDES.length) % SLIDES.length, -1]);
  const goTo = (target: number) =>
    setSlide(([i]) => [target, target === i ? 0 : target > i ? 1 : -1]);

  // Auto-advance.  The effect re-arms on every index change, so a manual
  // navigation always gets a full delay before the next automatic slide.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(goNext, AUTOPLAY_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, index]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="CNNHS election highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative overflow-hidden text-white"
      style={{ background: slide.tint }}
    >
      <div className="relative min-h-[560px] sm:min-h-[580px] md:min-h-[620px]">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            variants={reduceMotion ? fadeVariants : slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduceMotion ? 0.25 : 0.65, ease: "easeInOut" }}
            className="absolute inset-0"
            role="group"
            aria-roledescription="slide"
            aria-label={`Slide ${index + 1} of ${SLIDES.length}: ${slide.eyebrow}`}
          >
            {/* Shared campus photo over the slide's own maroon tint */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${cnnhsHero})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: 0.15,
              }}
            />
            <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 flex flex-col items-center justify-center text-center">
              {slide.showLogo && (
                <img src={cnnhsLogo} alt="CNNHS Logo" className="w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6" />
              )}
              <p className="text-xs sm:text-sm font-medium uppercase tracking-[0.2em] text-white/70 mb-4">
                {slide.eyebrow}
              </p>
              <h1 className="text-3xl sm:text-5xl md:text-6xl text-white mb-4" style={{ fontWeight: 700 }}>
                {slide.title}
              </h1>
              <p className="text-white/70 text-base sm:text-lg md:text-xl mb-8 max-w-2xl mx-auto">
                {slide.description}
              </p>
              {visibleCtas.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4">
                  {visibleCtas.map((cta) => {
                    // The calendar door follows the session: signed-in users
                    // land on their own portal's calendar, guests on /calendar.
                    const href = cta.calendarCta ? getCalendarHref(currentUser) : cta.to;
                    return (
                      <Link
                        key={cta.to}
                        to={href}
                        className={cn(
                          "px-6 py-3 rounded-xl text-sm font-medium transition-all",
                          cta.primary
                            ? "bg-white hover:shadow-lg hover:-translate-y-0.5"
                            : "border border-white/40 text-white hover:bg-white/10",
                        )}
                        style={cta.primary ? { color: "#5C0102" } : undefined}
                      >
                        {cta.label} {cta.primary && <ChevronRight size={16} className="inline" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Prev / next arrows */}
      <button
        type="button"
        onClick={goPrev}
        aria-label="Previous slide"
        className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 border border-white/30 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/25 transition-colors"
      >
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        onClick={goNext}
        aria-label="Next slide"
        className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 border border-white/30 backdrop-blur-sm text-white flex items-center justify-center hover:bg-white/25 transition-colors"
      >
        <ChevronRight size={20} />
      </button>

      {/* Dot indicators */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        {SLIDES.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to ${item.eyebrow} slide`}
            aria-current={i === index}
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              i === index ? "w-7 bg-white" : "w-2 bg-white/40 hover:bg-white/70",
            )}
          />
        ))}
      </div>
    </section>
  );
}
