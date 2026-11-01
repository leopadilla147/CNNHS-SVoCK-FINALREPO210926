import { addDays, endOfDay, format, isValid, parseISO, startOfDay } from "date-fns";
import type { ElectionPeriod } from "../context/AppContext";

/**
 * Election Calendar event model.
 *
 * The election schedule is spread across the `election_periods` columns the
 * Electoral Board fills in stage by stage (058 rules discussion, 093 campaign
 * window, 060 fingerprint window, the original voting date/time fields, and
 * the 081 proclamation stamps).  This module folds those columns into a
 * single chronology of `ElectionCalendarEvent`s so the calendar page can
 * render Month / Week / List views without knowing where each date lives.
 *
 * Only real schedule data becomes an event — a period that has not been
 * configured yet yields an empty list rather than placeholder rows.
 */

/** Event buckets, each with its own indicator colour in the calendar UI. */
export type ElectionEventCategory =
  /** 058: the Rules Discussion Meeting that opens the Campaign Stage. */
  | "campaign_meeting"
  /** 093: the Campaign window (posters, rallies, pronouncements). */
  | "campaign"
  /** 060: the Fingerprint Registration window at the IoT kiosks. */
  | "fingerprint"
  /** The Voting Stage itself (election_date + start/end time). */
  | "voting"
  /** Publication of official results / Proclamation of Winners (081). */
  | "results";

export interface ElectionCalendarEvent {
  id: string;
  title: string;
  description: string;
  category: ElectionEventCategory;
  /** First moment of the event.  All-day windows start at local midnight. */
  start: Date;
  /**
   * Inclusive end of the event.  Multi-day windows close at 23:59:59.999 of
   * their last day so day-bucketing keeps the whole span covered; point
   * events (meetings, proclamation) span their own day.
   */
  end: Date;
  /** True for windows that occupy whole days (campaign, voting, …). */
  allDay: boolean;
  /** "8:00 AM" / "8:00 AM – 5:00 PM" when clock times are known. */
  timeLabel?: string;
  location?: string;
}

export type EventStatus = "upcoming" | "ongoing" | "done";

/** Indicator palette — one colour per category, shared by dots, pills, and legend. */
export const EVENT_CATEGORY_META: Record<ElectionEventCategory, { label: string; color: string }> = {
  campaign_meeting: { label: "Campaign Meeting", color: "#B45309" },
  campaign: { label: "Campaign Period", color: "#6D28D9" },
  fingerprint: { label: "Fingerprint Registration", color: "#0E7490" },
  voting: { label: "Voting", color: "#5C0102" },
  results: { label: "Results", color: "#15803D" },
};

/**
 * Accepts every shape the data layer produces: a bare "YYYY-MM-DD" (the
 * schedule editor's date fields), "YYYY-MM-DD" + "HH:mm" (the time fields),
 * or a raw timestamptz string straight from PostgREST (campaign_start_at,
 * rules_discussion_at, proclaimed_at, …).  Returns local time, or null when
 * nothing usable was provided.
 */
export function parseEventDate(date?: string | null, time?: string | null): Date | null {
  if (!date) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (bare) {
    const clock = /^(\d{1,2}):(\d{2})/.exec((time ?? "").trim());
    const parsed = new Date(
      Number(bare[1]),
      Number(bare[2]) - 1,
      Number(bare[3]),
      clock ? Number(clock[1]) : 0,
      clock ? Number(clock[2]) : 0,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const iso = parseISO(date.trim());
  return isValid(iso) ? iso : null;
}

const hasClockTime = (value: Date): boolean => value.getHours() !== 0 || value.getMinutes() !== 0;

/** "8:00 AM – 5:00 PM" from a parsed pair; undefined when both ends are date-only. */
function timeRangeLabel(start: Date, end: Date): string | undefined {
  const startHas = hasClockTime(start);
  const endHas = hasClockTime(end) && start.getTime() !== end.getTime();
  if (!startHas && !endHas) return undefined;
  if (startHas && endHas) return `${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
  return startHas ? format(start, "h:mm a") : `Until ${format(end, "h:mm a")}`;
}

/** All-day window helper: midnight of the first day through the end of the last. */
function window(start: Date, end: Date): { start: Date; end: Date } {
  return { start: startOfDay(start), end: endOfDay(end) };
}

/**
 * Folds the election period's schedule columns into one chronology,
 * sorted by start.  Windows (campaign, fingerprint, voting) are all-day
 * spans; meetings and the proclamation are timed points on their day.
 */
export function buildElectionEvents(period: ElectionPeriod): ElectionCalendarEvent[] {
  const events: ElectionCalendarEvent[] = [];

  // Stage 2 opener (058): the Rules Discussion Meeting — timed, its own day.
  const rulesAt = parseEventDate(period.rulesDiscussionAt);
  if (rulesAt) {
    events.push({
      id: "rules-discussion",
      title: "Rules Discussion Meeting",
      description: "The Electoral Board and the candidates finalize the campaign rules and guidelines.",
      category: "campaign_meeting",
      start: rulesAt,
      end: endOfDay(rulesAt),
      allDay: false,
      timeLabel: format(rulesAt, "h:mm a"),
    });
  }

  // Stage 2 (093): the Campaign window.  mapElectionPeriod passes the raw
  // campaign_start_at / campaign_end_at timestamps through, so parse both.
  const campaignStart = parseEventDate(period.campaignStartDate, period.campaignStartTime);
  const campaignEnd = parseEventDate(period.campaignEndDate, period.campaignEndTime);
  if (campaignStart) {
    const span = window(campaignStart, campaignEnd ?? campaignStart);
    events.push({
      id: "campaign-period",
      title: "Campaign Period",
      description: "Official campaign activities — posters, rallies, and party pronouncements.",
      category: "campaign",
      ...span,
      allDay: true,
      timeLabel: timeRangeLabel(campaignStart, campaignEnd ?? campaignStart),
    });
  }

  // Stage 3 (060): the Fingerprint Registration window at the kiosks.
  const fingerprintStart = parseEventDate(period.fingerprintRegistrationStartAt);
  const fingerprintEnd = parseEventDate(period.fingerprintRegistrationEndAt);
  if (fingerprintStart) {
    const span = window(fingerprintStart, fingerprintEnd ?? fingerprintStart);
    events.push({
      id: "fingerprint-registration",
      title: "Fingerprint Registration",
      description: "Biometric enrolment at the IoT kiosks — register your fingerprint so you can vote.",
      category: "fingerprint",
      ...span,
      allDay: true,
      timeLabel: timeRangeLabel(fingerprintStart, fingerprintEnd ?? fingerprintStart),
      location: period.venue || undefined,
    });
  }

  // Stage 4: the Voting Stage — the election date/time fields the schedule
  // editor has owned since 001.
  const voteStart = parseEventDate(period.startDate, period.startTime);
  const voteEnd = parseEventDate(period.endDate, period.endTime);
  if (voteStart) {
    const span = window(voteStart, voteEnd ?? voteStart);
    events.push({
      id: "voting-day",
      title: "Voting Day",
      description: "Cast your ballot at the biometric kiosks — one scan, one secure vote.",
      category: "voting",
      ...span,
      allDay: true,
      timeLabel: timeRangeLabel(voteStart, voteEnd ?? voteStart),
      location: period.venue || undefined,
    });
  }

  // Stage 5 (081): results.  A proclamation timestamp is the real event;
  // otherwise publication is expected within 48 hours after voting closes,
  // so it shows as a two-day "expected" window starting the day after.
  const voteEndRef = parseEventDate(period.votingEndedAt) ?? voteEnd ?? voteStart;
  const proclaimedAt = parseEventDate(period.proclaimedAt);
  if (proclaimedAt) {
    events.push({
      id: "proclamation",
      title: "Proclamation of Winners",
      description: "The Electoral Board formally proclaims the winning candidates.",
      category: "results",
      start: proclaimedAt,
      end: endOfDay(proclaimedAt),
      allDay: false,
      timeLabel: format(proclaimedAt, "h:mm a"),
      location: period.venue || undefined,
    });
  } else if (voteEndRef) {
    const expectedStart = startOfDay(addDays(voteEndRef, 1));
    events.push({
      id: "results-publication",
      title: period.resultsPublished ? "Results Publication" : "Results Publication (Expected)",
      description: "Official results are posted publicly within 48 hours after voting closes.",
      category: "results",
      start: expectedStart,
      end: endOfDay(addDays(expectedStart, 1)),
      allDay: true,
    });
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Where an event sits relative to `now` — drives "Happening now" chips. */
export function eventStatus(event: ElectionCalendarEvent, now: Date = new Date()): EventStatus {
  if (now.getTime() < event.start.getTime()) return "upcoming";
  if (now.getTime() <= event.end.getTime()) return "ongoing";
  return "done";
}

/** Every event that touches the given day (multi-day windows included). */
export function eventsOnDay(events: ElectionCalendarEvent[], day: Date): ElectionCalendarEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = endOfDay(day).getTime();
  return events.filter((event) => event.start.getTime() <= dayEnd && event.end.getTime() >= dayStart);
}
