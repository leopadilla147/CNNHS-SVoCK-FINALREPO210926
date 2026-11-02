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
    title: "Camarines Norte National High School",
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
      className="relative overflow-hidden text-white w-full h-[calc(100vh-4rem)] min-h-[580px] flex flex-col justify-between select-none"
      style={{ background: slide.tint }}
    >
      <div className="relative flex-1 w-full h-full">
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
            <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 flex flex-col items-center justify-center text-center">
              {slide.showLogo && (
                <div className="p-1 rounded-full bg-white/20 backdrop-blur-md border border-white/30 border-b-2 border-b-black/30 shadow-[0_6px_20px_rgba(0,0,0,0.25)] mx-auto mb-5 sm:mb-6">
                  <img src={cnnhsLogo} alt="CNNHS Logo" className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover" />
                </div>
              )}
              <p className="text-xs sm:text-sm font-bold uppercase tracking-[0.2em] text-white/85 mb-4 px-3.5 py-1 rounded-full bg-white/10 backdrop-blur-xs border border-white/15 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">
                {slide.eyebrow}
              </p>
              <h1
                className={cn(
                  "text-white mb-4 tracking-tight drop-shadow-md font-extrabold",
                  slide.id === "welcome"
                    ? "text-xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl whitespace-nowrap"
                    : "text-3xl sm:text-5xl md:text-6xl",
                )}
                style={{ fontWeight: 800 }}
              >
                {slide.title}
              </h1>
              <p
                className={cn(
                  "text-white/85 mb-8 mx-auto font-medium leading-relaxed drop-shadow-xs",
                  slide.id === "welcome"
                    ? "text-xs sm:text-sm md:text-base lg:text-lg xl:text-xl whitespace-nowrap max-w-5xl"
                    : "text-base sm:text-lg md:text-xl max-w-2xl",
                )}
              >
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
                          "px-6 py-3 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer flex items-center gap-1.5",
                          cta.primary
                            ? "bg-white text-[#5C0102] border-b-[3.5px] border-b-stone-300 shadow-[0_4px_14px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,1)] hover:brightness-105 hover:shadow-[0_8px_22px_rgba(0,0,0,0.32)] hover:-translate-y-0.5 active:translate-y-[1px] active:border-b-2"
                            : "bg-white/15 text-white border border-white/35 border-b-[3px] border-b-black/25 backdrop-blur-xs shadow-[0_4px_14px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-white/25 hover:-translate-y-0.5 active:translate-y-[1px] active:border-b-2",
                        )}
                        style={cta.primary ? { color: "#5C0102" } : undefined}
                      >
                        {cta.label} {cta.primary && <ChevronRight size={16} className="inline ml-0.5" />}
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
        className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 z-20 w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-black/25 hover:bg-black/40 border border-white/30 border-b-2 border-b-black/40 backdrop-blur-md text-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.25)] active:translate-y-[1px] transition-all cursor-pointer"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        onClick={goNext}
        aria-label="Next slide"
        className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 z-20 w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-black/25 hover:bg-black/40 border border-white/30 border-b-2 border-b-black/40 backdrop-blur-md text-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.25)] active:translate-y-[1px] transition-all cursor-pointer"
      >
        <ChevronRight size={22} />
      </button>

      {/* Dot indicators */}
      <div className="absolute bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-black/25 backdrop-blur-md border border-white/20 shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
        {SLIDES.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Go to ${item.eyebrow} slide`}
            aria-current={i === index}
            className={cn(
              "h-2.5 rounded-full transition-all duration-300 cursor-pointer",
              i === index ? "w-8 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" : "w-2.5 bg-white/40 hover:bg-white/70",
            )}
          />
        ))}
      </div>
    </section>
  );
}
