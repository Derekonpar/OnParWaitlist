import type { Activity, SessionDuration } from "./types";

/** Total lanes / tables available at the venue per activity. */
export const ACTIVITY_CAPACITY: Record<Activity, number> = {
  bowling: Number(process.env.VENUE_BOWLING_LANES) || 12,
  darts: Number(process.env.NEXT_PUBLIC_VENUE_DART_LANES) || 6,
  pool: 3,
  shuffleboard: 2,
};

export const ACTIVITY_RESOURCE_LABEL: Record<Activity, string> = {
  bowling: "Number of lanes",
  darts: "Number of lanes",
  pool: "Number of tables",
  shuffleboard: "Number of lanes",
};

/** Max lanes/tables a single party can book at once. */
export function maxBookableLanes(activity: Activity): number {
  if (activity === "bowling") {
    return Math.min(4, ACTIVITY_CAPACITY[activity]);
  }
  return ACTIVITY_CAPACITY[activity];
}

export function laneCountOptions(activity: Activity): number[] {
  const max = maxBookableLanes(activity);
  return Array.from({ length: max }, (_, i) => i + 1);
}

const SESSION_OPTIONS: Record<Activity, SessionDuration[]> = {
  bowling: [120, 60, 30],
  darts: [60, 30],
  pool: [60, 30],
  shuffleboard: [60, 30],
};

export function sessionOptionsFor(activity: Activity): SessionDuration[] {
  return [...SESSION_OPTIONS[activity]];
}

export function defaultSessionMinutesFor(activity: Activity): SessionDuration {
  return SESSION_OPTIONS[activity][0];
}

export function normalizeLaneCount(activity: Activity, value: number): number {
  const max = maxBookableLanes(activity);
  const n = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(max, Math.max(1, n));
}

export function normalizeSessionMinutes(
  activity: Activity,
  value: number,
): number {
  const options = sessionOptionsFor(activity);
  if (value >= 120 && options.includes(120)) return 120;
  if (value >= 60 && options.includes(60)) return 60;
  return 30;
}

export function isValidLaneCount(activity: Activity, laneCount: number): boolean {
  return laneCountOptions(activity).includes(laneCount);
}

export function isValidSessionMinutes(
  activity: Activity,
  sessionMinutes: number,
): boolean {
  return sessionOptionsFor(activity).includes(
    sessionMinutes as SessionDuration,
  );
}

export function formatSessionLabel(minutes: number): string {
  if (minutes >= 120) return "2 hours";
  if (minutes >= 60) return "1 hour";
  return "30 min";
}

export function resourceUnit(activity: Activity, count: number): string {
  const base = activity === "pool" ? "table" : "lane";
  return count === 1 ? base : `${base}s`;
}

export function formatBookingSummary(
  activity: Activity,
  laneCount: number,
  sessionMinutes: number,
): string {
  return `${laneCount} ${resourceUnit(activity, laneCount)} · ${formatSessionLabel(sessionMinutes)}`;
}
