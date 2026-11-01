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
 * results) rendered as one calendar with Month / Week / List views.  Each
 * event category carries its own indicator colour, used by the day-cell
 * dots/pills, the week cards, the list rows, and the legend.
 */

type CalendarView = "month" | "week" | "list";

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BRAND = "#5C0102";

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

/** Small coloured category chip (dot + label) — the event indicator legend unit. */
function CategoryChip({ category, count }: { category: ElectionEventCategory; count?: number }) {
  const meta = EVENT_CATEGORY_META[category];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
      {meta.label}
      {count !== undefined && <span className="text-gray-400">({count})</span>}
    </span>
  );
}

function Legend({ events }: { events: ElectionCalendarEvent[] }) {
  const categories = (Object.keys(EVENT_CATEGORY_META) as ElectionEventCategory[]).filter((category) =>
    events.some((event) => event.category === category),
  );
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

/** One event row shared by the week cards and the day agenda. */
function EventDotRow({ event, compact = false }: { event: ElectionCalendarEvent; compact?: boolean }) {
  const meta = EVENT_CATEGORY_META[event.category];
  return (
    <div
      className={cn("rounded-lg px-2 py-1.5", compact && "px-1.5 py-1")}
      style={{ backgroundColor: `${meta.color}14` }}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: meta.color }}
        />
        <div className="min-w-0">
          <p className={cn("font-semibold leading-tight truncate", compact ? "text-[11px]" : "text-xs")} style={{ color: meta.color }}>
            {event.title}
          </p>
          <p className="text-[10px] text-gray-500">{eventTimeText(event)}</p>
        </div>
      </div>
    </div>
  );
}

/** A dated row in the List view. */
function ListRow({ event }: { event: ElectionCalendarEvent }) {
  const meta = EVENT_CATEGORY_META[event.category];
  const status = eventStatus(event);
  const range = eventRangeText(event);
  return (
    <div className="flex items-start gap-3 sm:gap-4 py-4 border-b border-gray-100 last:border-b-0 last:pb-0">
      {/* Date block */}
      <div className="w-14 flex-shrink-0 text-center rounded-xl border border-gray-200 overflow-hidden bg-white">
        <div className="text-[10px] uppercase font-semibold text-white py-0.5" style={{ backgroundColor: meta.color }}>
          {format(event.start, "MMM")}
        </div>
        <div className="text-xl font-bold text-gray-900 py-1 leading-none">{format(event.start, "d")}</div>
        <div className="text-[10px] text-gray-400 pb-1">{format(event.start, "yyyy")}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm sm:text-base font-semibold text-gray-900">{event.title}</h3>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.label}
          </span>
          {status === "ongoing" && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Happening now
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-1">{event.description}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Clock size={12} /> {eventTimeText(event)}
          </span>
          {range && (
            <span className="inline-flex items-center gap-1">
              <CalendarRange size={12} /> {range}
            </span>
          )}
          {event.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {event.location}
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden mb-8 text-white"
          style={{ background: "linear-gradient(135deg, #5C0102 0%, #8B0103 100%)" }}
        >
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <h1 className="text-3xl sm:text-4xl font-semibold flex items-center gap-3">
              <CalendarDays size={32} className="flex-shrink-0" />
              <span>Election Calendar</span>
            </h1>
            <p className="text-white/75 mt-2 max-w-2xl">
              Every key date of the SSLG election — candidacy, campaign, fingerprint registration,
              voting, and results — in one calendar.
            </p>
            {(electionPeriod.schoolYear || electionPeriod.venue) && (
              <div className="flex flex-wrap gap-2 mt-4">
                {electionPeriod.schoolYear && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-white/10 border border-white/20 rounded-full px-3 py-1">
                    S.Y. {electionPeriod.schoolYear}
                  </span>
                )}
                {electionPeriod.venue && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-white/10 border border-white/20 rounded-full px-3 py-1">
                    <MapPin size={12} /> {electionPeriod.venue}
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {events.length === 0 ? (
          /* Empty state — nothing scheduled yet. */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center"
          >
            <div
              className="w-14 h-14 mx-auto rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4"
              style={{ color: BRAND }}
            >
              <CalendarX2 size={26} />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">No election events scheduled yet</h2>
            <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">
              Key dates — the rules discussion, campaign window, fingerprint registration, voting
              day, and results — will appear here once the election schedule is set.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6"
          >
            {/* Legend + view tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Legend events={events} />
              <Tabs value={view} onValueChange={(value) => setView(value as CalendarView)}>
                <TabsList>
                  <TabsTrigger value="month">
                    <CalendarDays size={14} /> Month
                  </TabsTrigger>
                  <TabsTrigger value="week">
                    <CalendarRange size={14} /> Week
                  </TabsTrigger>
                  <TabsTrigger value="list">
                    <ListChecks size={14} /> List
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Range label + navigation */}
            {view !== "list" && (
              <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  {view === "month" ? format(monthCursor, "MMMM yyyy") : weekLabel}
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={view === "month" ? "Previous month" : "Previous week"}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={goToday}
                    className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] transition-colors"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={view === "month" ? "Next month" : "Next week"}
                    className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-[#5C0102] transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {view === "month" && (
              <div className="mt-4">
                {/* Hairline grid: gap-px over a gray backdrop draws the borders. */}
                <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
                  {WEEKDAY_HEADERS.map((day) => (
                    <div
                      key={day}
                      className="bg-gray-50 py-2 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-gray-500"
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
                          "min-h-[76px] sm:min-h-[100px] lg:min-h-[116px] w-full p-1.5 sm:p-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5C0102]",
                          outside ? "bg-gray-50/80 hover:bg-gray-100" : "bg-white hover:bg-gray-50",
                          selected && "ring-2 ring-inset ring-[#5C0102]",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                              today ? "text-white" : outside ? "text-gray-400" : "text-gray-700",
                              selected && !today && "text-[#5C0102] font-semibold",
                            )}
                            style={today ? { backgroundColor: BRAND } : undefined}
                          >
                            {format(day, "d")}
                          </span>
                          {dayEvents.length > 0 && (
                            <span className="text-[10px] font-medium text-gray-400">{dayEvents.length}</span>
                          )}
                        </div>

                        {/* Event indicator pills (md and up) */}
                        <div className="mt-1 space-y-0.5 hidden md:block">
                          {dayEvents.slice(0, 2).map((event) => {
                            const meta = EVENT_CATEGORY_META[event.category];
                            return (
                              <div
                                key={event.id}
                                className="truncate text-[10px] leading-4 px-1.5 rounded"
                                style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
                              >
                                {event.allDay ? "" : `${format(event.start, "h:mm a")} · `}
                                {event.title}
                              </div>
                            );
                          })}
                          {dayEvents.length > 2 && (
                            <div className="text-[10px] text-gray-500 px-1.5">+{dayEvents.length - 2} more</div>
                          )}
                        </div>

                        {/* Event indicator dots (small screens) */}
                        <div className="flex gap-1 mt-1.5 md:hidden">
                          {dayEvents.slice(0, 4).map((event) => (
                            <span
                              key={event.id}
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: EVENT_CATEGORY_META[event.category].color }}
                            />
                          ))}
                          {dayEvents.length > 4 && (
                            <span className="text-[9px] leading-3 text-gray-400">+{dayEvents.length - 4}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected-day agenda */}
                <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <CalendarDays size={14} style={{ color: BRAND }} />
                      {isSameDay(selectedDay, now) ? "Today" : format(selectedDay, "EEEE, MMMM d, yyyy")}
                    </h3>
                    {selectedDayEvents.length > 0 && (
                      <span className="text-xs text-gray-400">
                        {selectedDayEvents.length} event{selectedDayEvents.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {selectedDayEvents.length === 0 ? (
                    <p className="text-sm text-gray-400 mt-3">No events on this day.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {selectedDayEvents.map((event) => (
                        <li key={event.id} className="flex items-start gap-2.5">
                          <span
                            className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: EVENT_CATEGORY_META[event.category].color }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {event.title}
                              <span className="text-xs text-gray-400 font-normal">
                                {" "}
                                · {EVENT_CATEGORY_META[event.category].label}
                              </span>
                            </p>
                            <p className="text-xs text-gray-500">
                              {eventTimeText(event)}
                              {event.location ? ` · ${event.location}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {view === "week" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {weekDays.map((day) => {
                  const dayEvents = eventsOnDay(events, day);
                  const today = isToday(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "rounded-xl border overflow-hidden bg-white flex flex-col",
                        today ? "border-[#5C0102] ring-1 ring-[#5C0102]" : "border-gray-200",
                      )}
                    >
                      <div
                        className={cn(
                          "px-3 py-2 text-center",
                          today ? "text-white" : "bg-gray-50 border-b border-gray-200",
                        )}
                        style={today ? { backgroundColor: BRAND } : undefined}
                      >
                        <div className={cn("text-[11px] uppercase tracking-wide", today ? "text-white/80" : "text-gray-500")}>
                          {format(day, "EEE")}
                        </div>
                        <div className={cn("text-lg font-semibold", today ? "" : "text-gray-900")}>
                          {format(day, "d")}
                        </div>
                      </div>
                      <div className="p-2 space-y-1.5 flex-1 min-h-[110px]">
                        {dayEvents.length === 0 ? (
                          <p className="text-[11px] text-gray-400 text-center pt-8">No events</p>
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
              <div className="mt-5 space-y-8">
                <section>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Upcoming & Current
                  </h2>
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-gray-400 mt-3">No upcoming events.</p>
                  ) : (
                    <div className="mt-2">
                      {upcoming.map((event) => (
                        <ListRow key={event.id} event={event} />
                      ))}
                    </div>
                  )}
                </section>
                {past.length > 0 && (
                  <section>
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                      Past
                    </h2>
                    <div className="mt-2">
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
