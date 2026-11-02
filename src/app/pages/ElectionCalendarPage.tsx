import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  CalendarDays,
  CalendarRange,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn } from "../components/ui/utils";
import { useApp } from "../context/AppContext";
import {
  buildElectionEvents,
  EVENT_CATEGORY_META,
  eventStatus,
  eventsOnDay,
  type ElectionCalendarEvent,
  type ElectionEventCategory,
} from "../lib/electionCalendar";

/**
 * The Election Calendar — every schedule milestone the Electoral Board sets
 * (rules discussion, campaign window, fingerprint registration, voting,
 * results) rendered as one calendar with Month / Week / List views. Each
 * event category carries its own 3D indicator style, used by the day-cell
 * micro-cards, the week tiles, the list rows, and the tactile 3D legends.
 */

type CalendarView = "month" | "week" | "list";

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BRAND = "#5C0102";

/** 3D spherical radial highlight + multi-tier shadow helper for 3D indicators */
function get3DSphereStyle(color: string) {
  return {
    background: `radial-gradient(circle at 35% 28%, #ffffff 0%, ${color} 55%, #0f172a 140%)`,
    boxShadow: `0 3px 6px -1px ${color}66, 0 2px 4px -1px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.7), inset 0 -1px 2px rgba(0,0,0,0.4)`,
  };
}

/** "8:00 AM – 5:00 PM" when known, otherwise "All-day". */
function eventTimeText(event: ElectionCalendarEvent): string {
  return event.timeLabel ?? "All-day";
}

/** "Feb 10 – Feb 12" for multi-day spans; "" when the event sits on one day. */
function eventRangeText(event: ElectionCalendarEvent): string {
  const from = format(event.start, "MMM d");
  const to = format(event.end, "MMM d");
  return from === to ? "" : `${from} – ${to}`;
}

/** 3D tactile category chip (3D sphere + label + embossed counter) */
function CategoryChip({ category, count }: { category: ElectionEventCategory; count?: number }) {
  const meta = EVENT_CATEGORY_META[category];
  const sphereStyle = get3DSphereStyle(meta.color);

  return (
    <div
      className="group inline-flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-white border border-gray-200/90 shadow-[0_3px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 transition-all duration-200 cursor-default select-none"
      style={{
        borderBottom: `2.5px solid ${meta.color}`,
      }}
    >
      <span
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 transition-transform duration-200 group-hover:scale-115"
        style={sphereStyle}
      />
      <span className="text-xs font-bold text-gray-800 tracking-tight">
        {meta.label}
      </span>
      {count !== undefined && (
        <span
          className="px-2 py-0.5 rounded-full text-[11px] font-extrabold shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] border transition-colors"
          style={{
            backgroundColor: `${meta.color}14`,
            color: meta.color,
            borderColor: `${meta.color}30`,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function Legend({ events }: { events: ElectionCalendarEvent[] }) {
  const categories = (Object.keys(EVENT_CATEGORY_META) as ElectionEventCategory[]).filter((category) =>
    events.some((event) => event.category === category),
  );
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {categories.map((category) => (
        <CategoryChip
          key={category}
          category={category}
          count={events.filter((event) => event.category === category).length}
        />
      ))}
    </div>
  );
}

/** One 3D event card row shared by the week cards and the day agenda. */
function EventDotRow({ event, compact = false }: { event: ElectionCalendarEvent; compact?: boolean }) {
  const meta = EVENT_CATEGORY_META[event.category];
  return (
    <div
      className={cn(
        "rounded-xl px-2.5 py-2 border-l-[3px] shadow-[0_2px_5px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)] border border-gray-200/70 transition-all duration-150 hover:scale-[1.02]",
        compact && "px-2 py-1.5",
      )}
      style={{
        backgroundColor: `${meta.color}12`,
        borderLeftColor: meta.color,
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
          style={get3DSphereStyle(meta.color)}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn("font-bold leading-tight truncate", compact ? "text-[11px]" : "text-xs")}
            style={{ color: meta.color }}
          >
            {event.title}
          </p>
          <p className="text-[10px] text-gray-500 font-medium mt-0.5">{eventTimeText(event)}</p>
        </div>
      </div>
    </div>
  );
}

/** A 3D dated row in the List view. */
function ListRow({ event }: { event: ElectionCalendarEvent }) {
  const meta = EVENT_CATEGORY_META[event.category];
  const status = eventStatus(event);
  const range = eventRangeText(event);
  return (
    <div className="group flex items-start gap-3.5 sm:gap-5 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200/80 shadow-[0_3px_8px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_8px_22px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-200">
      {/* 3D Date block / Tear-off desk calendar tile */}
      <div className="w-16 sm:w-20 flex-shrink-0 text-center rounded-2xl border border-gray-200 border-b-[3px] border-b-gray-300 overflow-hidden bg-white shadow-[0_3px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)]">
        <div
          className="text-[10px] sm:text-[11px] uppercase font-bold text-white py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] tracking-wider"
          style={{
            background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}dd 100%)`,
          }}
        >
          {format(event.start, "MMM")}
        </div>
        <div className="text-2xl sm:text-3xl font-black text-gray-900 py-1 sm:py-1.5 leading-none">
          {format(event.start, "d")}
        </div>
        <div className="text-[10px] font-semibold text-gray-400 pb-1.5 border-t border-gray-100">
          {format(event.start, "yyyy")}
        </div>
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm sm:text-base font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors">
            {event.title}
          </h3>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)]"
            style={{
              backgroundColor: `${meta.color}14`,
              color: meta.color,
              borderColor: `${meta.color}30`,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={get3DSphereStyle(meta.color)} />
            {meta.label}
          </span>
          {status === "ongoing" && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Happening now
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-gray-600 mt-1.5 leading-relaxed">{event.description}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 pt-2.5 border-t border-gray-100 text-xs text-gray-500 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} className="text-gray-400" /> {eventTimeText(event)}
          </span>
          {range && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange size={13} className="text-gray-400" /> {range}
            </span>
          )}
          {event.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={13} className="text-gray-400" /> {event.location}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ElectionCalendarPage() {
  const { electionPeriod } = useApp();
  // Frozen per mount — long-lived tabs should not flip an event's status chip mid-session.
  const [now] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [weekCursor, setWeekCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());

  const events = useMemo(() => buildElectionEvents(electionPeriod), [electionPeriod]);

  // Six calendar weeks covering the displayed month (leading + trailing days).
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [monthCursor]);

  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(weekCursor, { weekStartsOn: 0 }),
        end: endOfWeek(weekCursor, { weekStartsOn: 0 }),
      }),
    [weekCursor],
  );

  const weekLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[weekDays.length - 1];
    return first.getMonth() === last.getMonth()
      ? `${format(first, "MMMM d")} – ${format(last, "d, yyyy")}`
      : `${format(first, "MMM d")} – ${format(last, "MMM d, yyyy")}`;
  }, [weekDays]);

  const selectedDayEvents = useMemo(() => eventsOnDay(events, selectedDay), [events, selectedDay]);

  const upcoming = useMemo(() => events.filter((event) => eventStatus(event, now) !== "done"), [events, now]);
  const past = useMemo(
    () => events.filter((event) => eventStatus(event, now) === "done").reverse(),
    [events, now],
  );

  const goPrev = () => {
    if (view === "week") setWeekCursor(addDays(weekCursor, -7));
    else setMonthCursor(addMonths(monthCursor, -1));
  };
  const goNext = () => {
    if (view === "week") setWeekCursor(addDays(weekCursor, 7));
    else setMonthCursor(addMonths(monthCursor, 1));
  };
  const goToday = () => {
    const today = new Date();
    setMonthCursor(today);
    setWeekCursor(today);
    setSelectedDay(today);
  };

  return (
    <div className="min-h-[70vh] bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* 3D Hero Banner */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden mb-8 text-white shadow-[0_16px_36px_-6px_rgba(92,1,2,0.35),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-2px_0_rgba(0,0,0,0.2)]"
          style={{
            background: "linear-gradient(135deg, #4A0102 0%, #5C0102 50%, #8B0103 100%)",
          }}
        >
          {/* Subtle 3D background shapes */}
          <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-white/5 blur-2xl pointer-events-none" />
          <div className="absolute right-32 -bottom-16 w-48 h-48 rounded-full bg-black/15 blur-xl pointer-events-none" />

          <div className="relative px-6 py-8 sm:px-10 sm:py-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-2xl">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 shadow-[0_4px_12px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.4)] flex items-center justify-center shrink-0">
                  <CalendarDays size={28} className="text-white drop-shadow" />
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-200">
                    Official Schedule
                  </span>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white drop-shadow-sm">
                    Election Calendar
                  </h1>
                </div>
              </div>
              <p className="text-white/80 mt-3 text-sm sm:text-base leading-relaxed">
                Every key date of the SSLG election — candidacy, campaign, fingerprint registration,
                voting, and results — organized in one comprehensive calendar.
              </p>
              {(electionPeriod.schoolYear || electionPeriod.venue) && (
                <div className="flex flex-wrap gap-2.5 mt-4">
                  {electionPeriod.schoolYear && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                      S.Y. {electionPeriod.schoolYear}
                    </span>
                  )}
                  {electionPeriod.venue && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                      <MapPin size={13} /> {electionPeriod.venue}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {events.length === 0 ? (
          /* Empty state — nothing scheduled yet. */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl shadow-[0_12px_36px_-6px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200/80 p-12 sm:p-16 text-center"
          >
            <div
              className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-200 flex items-center justify-center mb-5 text-[#5C0102] shadow-[0_4px_12px_rgba(92,1,2,0.1),inset_0_1px_0_rgba(255,255,255,0.8)]"
            >
              <CalendarX2 size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">No election events scheduled yet</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto leading-relaxed">
              Key dates — the rules discussion, campaign window, fingerprint registration, voting
              day, and results — will appear here once the election schedule is set.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl shadow-[0_12px_36px_-6px_rgba(0,0,0,0.08),0_4px_16px_-4px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] border border-gray-200/80 p-5 sm:p-7 space-y-6"
          >
            {/* 3D Legend + View Segmented Tabs */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-100">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5C0102]" />
                  <span>Event Categories Legend</span>
                </div>
                <Legend events={events} />
              </div>
              <div className="self-start lg:self-center shrink-0">
                <Tabs value={view} onValueChange={(value) => setView(value as CalendarView)}>
                  <TabsList className="bg-gray-100/90 p-1.5 rounded-2xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.06),inset_0_1px_2px_rgba(0,0,0,0.08)] border border-gray-200/70 h-auto gap-1">
                    <TabsTrigger
                      value="month"
                      className="rounded-xl px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5C0102] data-[state=active]:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] data-[state=active]:border-b-2 data-[state=active]:border-b-gray-200 transition-all duration-200 flex items-center gap-1.5"
                    >
                      <CalendarDays size={14} /> Month
                    </TabsTrigger>
                    <TabsTrigger
                      value="week"
                      className="rounded-xl px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5C0102] data-[state=active]:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] data-[state=active]:border-b-2 data-[state=active]:border-b-gray-200 transition-all duration-200 flex items-center gap-1.5"
                    >
                      <CalendarRange size={14} /> Week
                    </TabsTrigger>
                    <TabsTrigger
                      value="list"
                      className="rounded-xl px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#5C0102] data-[state=active]:shadow-[0_2px_6px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] data-[state=active]:border-b-2 data-[state=active]:border-b-gray-200 transition-all duration-200 flex items-center gap-1.5"
                    >
                      <ListChecks size={14} /> List
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {/* Range label + 3D navigation controls */}
            {view !== "list" && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#5C0102] to-[#8B0103] text-white flex items-center justify-center shadow-[0_4px_10px_rgba(92,1,2,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]">
                    {view === "month" ? <CalendarDays size={20} /> : <CalendarRange size={20} />}
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight leading-none">
                      {view === "month" ? format(monthCursor, "MMMM yyyy") : weekLabel}
                    </h2>
                    <p className="text-xs text-gray-500 font-medium mt-1">
                      {view === "month"
                        ? "Click any day tile to inspect scheduled events"
                        : "Weekly timeline overview"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={view === "month" ? "Previous month" : "Previous week"}
                    className="w-9 h-9 rounded-xl bg-white border border-gray-200 border-b-[3px] border-b-gray-300 flex items-center justify-center text-gray-700 shadow-[0_2px_4px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] hover:bg-gray-50 hover:text-[#5C0102] hover:border-b-gray-400 active:translate-y-[2px] active:border-b transition-all duration-150 cursor-pointer"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={goToday}
                    className="h-9 px-4 rounded-xl bg-white border border-gray-200 border-b-[3px] border-b-gray-300 text-xs font-bold text-gray-700 shadow-[0_2px_4px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] hover:bg-gray-50 hover:text-[#5C0102] hover:border-b-gray-400 active:translate-y-[2px] active:border-b transition-all duration-150 cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={view === "month" ? "Next month" : "Next week"}
                    className="w-9 h-9 rounded-xl bg-white border border-gray-200 border-b-[3px] border-b-gray-300 flex items-center justify-center text-gray-700 shadow-[0_2px_4px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] hover:bg-gray-50 hover:text-[#5C0102] hover:border-b-gray-400 active:translate-y-[2px] active:border-b transition-all duration-150 cursor-pointer"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {view === "month" && (
              <div className="space-y-6">
                {/* 3D Month Grid Container */}
                <div className="rounded-2xl border border-gray-200/90 shadow-[0_6px_20px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)] overflow-hidden bg-gray-200/90">
                  <div className="grid grid-cols-7 gap-px">
                    {WEEKDAY_HEADERS.map((day) => (
                      <div
                        key={day}
                        className="bg-gradient-to-b from-gray-100 to-gray-200/60 py-2.5 text-center text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                      >
                        <span className="hidden sm:inline">{day}</span>
                        <span className="sm:hidden">{day.charAt(0)}</span>
                      </div>
                    ))}
                    {monthDays.map((day) => {
                      const dayEvents = eventsOnDay(events, day);
                      const outside = !isSameMonth(day, monthCursor);
                      const selected = isSameDay(day, selectedDay);
                      const today = isToday(day);
                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          onClick={() => setSelectedDay(day)}
                          aria-label={`${format(day, "MMMM d, yyyy")}${
                            dayEvents.length > 0 ? ` — ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}` : ""
                          }`}
                          className={cn(
                            "min-h-[86px] sm:min-h-[114px] lg:min-h-[132px] w-full p-2 sm:p-2.5 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5C0102] flex flex-col justify-start relative group cursor-pointer",
                            outside
                              ? "bg-gray-100/70 hover:bg-gray-100 text-gray-400"
                              : "bg-white hover:bg-gray-50/90 text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
                            selected &&
                              "ring-2 ring-inset ring-[#5C0102] bg-gradient-to-b from-white to-rose-50/40 shadow-[inset_0_2px_6px_rgba(92,1,2,0.1)]",
                          )}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span
                              className={cn(
                                "w-6 h-6 sm:w-7 sm:h-7 rounded-lg sm:rounded-xl flex items-center justify-center text-xs font-bold transition-all",
                                today
                                  ? "text-white shadow-[0_3px_6px_rgba(92,1,2,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
                                  : outside
                                    ? "text-gray-400"
                                    : selected
                                      ? "text-[#5C0102] bg-[#5C0102]/10 shadow-[inset_0_1px_2px_rgba(92,1,2,0.15)]"
                                      : "text-gray-700 group-hover:text-gray-950",
                              )}
                              style={
                                today
                                  ? { background: "linear-gradient(135deg, #7A0103 0%, #5C0102 100%)" }
                                  : undefined
                              }
                            >
                              {format(day, "d")}
                            </span>
                            {dayEvents.length > 0 && (
                              <span className="text-[10px] sm:text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)] border border-gray-200/50">
                                {dayEvents.length}
                              </span>
                            )}
                          </div>

                          {/* Event indicator pills (md and up) - ALL EVENTS VISIBLE DIRECTLY */}
                          <div className="mt-1 space-y-0.5 hidden md:block">
                            {dayEvents.map((event) => {
                              const meta = EVENT_CATEGORY_META[event.category];
                              return (
                                <div
                                  key={event.id}
                                  className="truncate text-[10px] leading-4 px-1.5 py-0.5 rounded font-medium border-l-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.7)] transition-all hover:scale-[1.01]"
                                  style={{
                                    backgroundColor: `${meta.color}18`,
                                    borderLeftColor: meta.color,
                                    color: meta.color,
                                    borderTop: "1px solid rgba(0,0,0,0.03)",
                                    borderRight: "1px solid rgba(0,0,0,0.03)",
                                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                                  }}
                                  title={`${event.title}${event.timeLabel ? ` (${event.timeLabel})` : ""}`}
                                >
                                  <span className="font-bold">
                                    {event.allDay ? "" : `${format(event.start, "h:mm a")} · `}
                                  </span>
                                  {event.title}
                                </div>
                              );
                            })}
                          </div>

                          {/* Event indicator 3D dots (small screens) */}
                          <div className="flex flex-wrap gap-1 mt-1 md:hidden">
                            {dayEvents.map((event) => {
                              const meta = EVENT_CATEGORY_META[event.category];
                              return (
                                <span
                                  key={event.id}
                                  className="w-2 h-2 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                                  style={get3DSphereStyle(meta.color)}
                                  title={event.title}
                                />
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected-day 3D agenda */}
                <div className="rounded-2xl border border-gray-200/90 bg-gradient-to-b from-white to-gray-50/50 p-5 shadow-[0_4px_12px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)]">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#5C0102] to-[#8B0103] text-white flex items-center justify-center shadow-[0_2px_6px_rgba(92,1,2,0.3),inset_0_1px_0_rgba(255,255,255,0.3)]">
                        <CalendarDays size={16} />
                      </div>
                      <h3 className="text-base font-bold text-gray-900 tracking-tight">
                        {isSameDay(selectedDay, now) ? "Today" : format(selectedDay, "EEEE, MMMM d, yyyy")}
                      </h3>
                    </div>
                    {selectedDayEvents.length > 0 && (
                      <span className="text-xs font-bold text-[#5C0102] bg-[#5C0102]/10 border border-[#5C0102]/20 rounded-full px-3 py-1 shadow-[inset_0_1px_2px_rgba(92,1,2,0.08)]">
                        {selectedDayEvents.length} Scheduled Event{selectedDayEvents.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {selectedDayEvents.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-sm text-gray-400 font-medium">No events scheduled on this day.</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {selectedDayEvents.map((event) => {
                        const meta = EVENT_CATEGORY_META[event.category];
                        const status = eventStatus(event, now);
                        return (
                          <div
                            key={event.id}
                            className="group relative rounded-xl border border-gray-200/90 bg-white p-4 shadow-[0_2px_6px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-200 border-l-4"
                            style={{ borderLeftColor: meta.color }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                                  <span
                                    className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)]"
                                    style={{
                                      backgroundColor: `${meta.color}14`,
                                      color: meta.color,
                                      borderColor: `${meta.color}30`,
                                    }}
                                  >
                                    <span className="w-2 h-2 rounded-full" style={get3DSphereStyle(meta.color)} />
                                    {meta.label}
                                  </span>
                                  {status === "ongoing" && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                      Ongoing
                                    </span>
                                  )}
                                </div>
                                <h4 className="text-sm font-bold text-gray-900 group-hover:text-[#5C0102] transition-colors leading-snug">
                                  {event.title}
                                </h4>
                                {event.description && (
                                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                                    {event.description}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t border-gray-100 text-xs text-gray-500 font-medium">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Clock size={13} className="text-gray-400" />
                                    {eventTimeText(event)}
                                  </span>
                                  {event.location && (
                                    <span className="inline-flex items-center gap-1.5">
                                      <MapPin size={13} className="text-gray-400" />
                                      {event.location}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {view === "week" && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {weekDays.map((day) => {
                  const dayEvents = eventsOnDay(events, day);
                  const today = isToday(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "rounded-2xl border overflow-hidden bg-white flex flex-col transition-all duration-200 shadow-[0_4px_12px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)]",
                        today
                          ? "border-[#5C0102] ring-2 ring-[#5C0102]/20 shadow-[0_6px_20px_rgba(92,1,2,0.15)]"
                          : "border-gray-200/90",
                      )}
                    >
                      <div
                        className={cn(
                          "px-3 py-2.5 text-center transition-colors border-b",
                          today
                            ? "text-white border-[#5C0102]"
                            : "bg-gradient-to-b from-gray-50 to-gray-100/70 border-gray-200/80",
                        )}
                        style={
                          today
                            ? {
                                background: "linear-gradient(135deg, #7A0103 0%, #5C0102 100%)",
                                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
                              }
                            : undefined
                        }
                      >
                        <div
                          className={cn(
                            "text-[11px] uppercase tracking-wider font-bold",
                            today ? "text-white/80" : "text-gray-500",
                          )}
                        >
                          {format(day, "EEE")}
                        </div>
                        <div
                          className={cn(
                            "text-xl font-black mt-0.5",
                            today ? "text-white drop-shadow-sm" : "text-gray-900",
                          )}
                        >
                          {format(day, "d")}
                        </div>
                      </div>
                      <div className="p-2.5 space-y-2 flex-1 min-h-[140px] bg-gradient-to-b from-white to-gray-50/30">
                        {dayEvents.length === 0 ? (
                          <p className="text-xs text-gray-400 font-medium text-center pt-10">No events</p>
                        ) : (
                          dayEvents.map((event) => <EventDotRow key={event.id} event={event} compact />)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {view === "list" && (
              <div className="space-y-8">
                <section>
                  <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 mb-4">
                    <span className="w-2.5 h-2.5 rounded-full" style={get3DSphereStyle("#10B981")} />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                      Upcoming & Current Events
                    </h2>
                    {upcoming.length > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]">
                        {upcoming.length}
                      </span>
                    )}
                  </div>
                  {upcoming.length === 0 ? (
                    <div className="p-8 text-center bg-gray-50/70 rounded-2xl border border-gray-100">
                      <p className="text-sm text-gray-400 font-medium">No upcoming events.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {upcoming.map((event) => (
                        <ListRow key={event.id} event={event} />
                      ))}
                    </div>
                  )}
                </section>
                {past.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 mb-4">
                      <span className="w-2.5 h-2.5 rounded-full" style={get3DSphereStyle("#9CA3AF")} />
                      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                        Concluded Events
                      </h2>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]">
                        {past.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {past.map((event) => (
                        <ListRow key={event.id} event={event} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
