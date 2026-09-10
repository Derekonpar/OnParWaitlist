import {
  getBowlingLaneSnapshot,
  type BowlingLaneSnapshot,
} from "./bowling-lanes";
import {
  dartseeSnapshotToAvailability,
  getDartseeLaneSnapshot,
  getStoredDartseeLaneSnapshot,
} from "./dartsee-lanes";
import type { ResourceLaneAvailability } from "./resource-scheduler";
import {
  getTimedResourceSessions,
  timedSessionsToAvailability,
} from "./resource-sessions";
import type { Activity } from "./types";
import {
  addScheduleWindows,
  getEntertainmentSchedule,
  getStoredEntertainmentSchedule,
} from "./entertainment-schedule";
import { withDeadline } from "./async-deadline";
import { bowlingLaneAvailableAtSeconds } from "./bowling-turnover";
import {
  bowlingDisplayMetadata,
  bowlingLaneDisplayStatus,
  bowlingLaneEvidenceFresh,
} from "./bowling-display-continuity";

export type ReservationScheduleStatus = "fresh" | "stale";

export type LiveLaneAvailability = Partial<
  Record<Activity, ResourceLaneAvailability[]>
> & {
  reservationScheduleStatus: ReservationScheduleStatus;
  bowlingDisplay?: { estimated: boolean; expiresAt: string };
};

export interface LiveLaneAvailabilityOptions {
  /** Contact Dartsee/Event Host. Public reads leave this false and refresh later. */
  refreshRemote?: boolean;
  /**
   * Passive public displays may show estimates from healthy live feeds while
   * separately warning that reservation protection is stale. Placement and
   * control paths must leave this false so they continue to fail closed.
   */
  allowStaleScheduleForDisplay?: boolean;
  /** Passive guest/TV board only; never use this to place guests or start lanes. */
  allowBowlingDisplayContinuity?: boolean;
}

const STORED_SOURCE_TIMEOUT_MS = 1_800;
const DARTSEE_MAX_STORED_AGE_MS = 60_000;
const BOWLING_MAX_STORED_AGE_MS = 120_000;
const ENTERTAINMENT_SCHEDULE_MAX_STORED_AGE_MS = 120_000;
const REMOTE_REFRESH_THROTTLE_MS = 15_000;

// A plain timestamp is safe to reuse between Cloudflare requests; an in-flight
// Promise is not. Each upstream also owns a durable lease, so this lightweight
// gate only prevents local guest/TV/staff polling from repeating storage and
// lease work during the same refresh window.
let nextRemoteRefreshAt = 0;

function boundedStoredRead<T>(task: Promise<T>): Promise<T | null> {
  return withDeadline<T | null>(task, STORED_SOURCE_TIMEOUT_MS, null);
}

function elapsedSeconds(iso?: string, nowMs = Date.now()): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((nowMs - ts) / 1000));
}

export function bowlingSnapshotToAvailability(
  snapshot: BowlingLaneSnapshot | null,
  nowMs = Date.now(),
  allowDisplayContinuity = false,
): ResourceLaneAvailability[] | undefined {
  if (!snapshot) return undefined;
  const elapsed = elapsedSeconds(snapshot.capturedAt, nowMs);
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  const snapshotTooOld =
    !Number.isFinite(capturedAt) ||
    capturedAt > nowMs ||
    nowMs - capturedAt > BOWLING_MAX_STORED_AGE_MS;
  return snapshot.lanes.map((lane) => {
    const strictUnavailable = snapshot.healthStatus !== "ok" || snapshotTooOld ||
      lane.estimated === true || !bowlingLaneEvidenceFresh(snapshot, lane, nowMs);
    const displayStatus = allowDisplayContinuity
      ? bowlingLaneDisplayStatus(snapshot, lane, nowMs)
      : lane.status;
    // A retained zero timer stays occupied with the cleaning buffer, never
    // "No Wait". The source-anchored display grace bounds this estimate.
    return {
      id: String(lane.lane),
      label: `Lane ${lane.lane}`,
      availableAtSeconds: !allowDisplayContinuity && strictUnavailable
        ? Number.POSITIVE_INFINITY
        : bowlingLaneAvailableAtSeconds(displayStatus, lane.remainingSeconds, elapsed),
    };
  });
}

export async function getLiveLaneAvailability(
  options: LiveLaneAvailabilityOptions = {},
): Promise<LiveLaneAvailability> {
  const refreshRemote = options.refreshRemote ?? false;
  const allowStaleScheduleForDisplay =
    options.allowStaleScheduleForDisplay ?? false;
  const allowBowlingDisplayContinuity = options.allowBowlingDisplayContinuity ?? false;
  const [bowlingResult, dartseeResult, timedResult, scheduleResult] = await Promise.allSettled([
    boundedStoredRead(getBowlingLaneSnapshot()),
    refreshRemote
      ? getDartseeLaneSnapshot()
      : boundedStoredRead(getStoredDartseeLaneSnapshot()),
    boundedStoredRead(getTimedResourceSessions()),
    refreshRemote
      ? getEntertainmentSchedule()
      : boundedStoredRead(getStoredEntertainmentSchedule()),
  ]);
  // Derive availability and its display expiry from one instant. Crossing the
  // grace boundary between those calculations must never drop the expiry from
  // an otherwise finite estimate and accidentally make it look live forever.
  const nowMs = Date.now();

  const schedule = scheduleResult.status === "fulfilled"
    ? scheduleResult.value
    : null;
  const reservations = schedule?.reservations ?? [];
  const scheduleFetchedAt = schedule
    ? new Date(schedule.fetchedAt).getTime()
    : Number.NaN;
  const scheduleUnavailable =
    !Number.isFinite(scheduleFetchedAt) ||
    nowMs - scheduleFetchedAt >
      ENTERTAINMENT_SCHEDULE_MAX_STORED_AGE_MS;
  const bowlingSnapshot = bowlingResult.status === "fulfilled" ? bowlingResult.value : null;
  const bowling = bowlingSnapshot
    ? bowlingSnapshotToAvailability(bowlingSnapshot, nowMs, allowBowlingDisplayContinuity)
    : undefined;
  const dartseeSnapshot = dartseeResult.status === "fulfilled"
    ? dartseeResult.value
    : null;
  let darts = dartseeSnapshotToAvailability(dartseeSnapshot);
  const dartseeCapturedAt = dartseeSnapshot
    ? new Date(dartseeSnapshot.capturedAt).getTime()
    : Number.NaN;
  const dartseeTooOld =
    !Number.isFinite(dartseeCapturedAt) ||
    nowMs - dartseeCapturedAt > DARTSEE_MAX_STORED_AGE_MS;
  const dartseeUnavailable =
    dartseeTooOld ||
    (dartseeSnapshot !== null &&
      dartseeSnapshot.healthStatus !== "ok" &&
      dartseeSnapshot.healthStatus !== "partial");
  if (darts && dartseeUnavailable) {
    // Keep canonical lane identities for deterministic queue planning, but an
    // old/error snapshot must never make a retained `open` reading assignable.
    darts = darts.map((lane) => ({
      ...lane,
      availableAtSeconds: Number.POSITIVE_INFINITY,
    }));
  }
  const pool = timedResult.status === "fulfilled" && timedResult.value
    ? timedSessionsToAvailability("pool", timedResult.value)
    : undefined;
  const shuffleboard = timedResult.status === "fulfilled" && timedResult.value
    ? timedSessionsToAvailability("shuffleboard", timedResult.value)
    : undefined;

  const applySchedule = (
    activity: Activity,
    lanes: ResourceLaneAvailability[] | undefined,
  ) => {
    if (!lanes) return undefined;
    const scheduled = addScheduleWindows(activity, lanes, reservations);
    if (!scheduleUnavailable || allowStaleScheduleForDisplay) return scheduled;
    // A missing or expired schedule cannot prove that an otherwise-open lane
    // is safe to book. Preserve known reservation windows and queue identity,
    // but mark the resulting wait unknown until the background refresh lands.
    return scheduled.map((lane) => ({
      ...lane,
      availableAtSeconds: Number.POSITIVE_INFINITY,
    }));
  };

  return {
    reservationScheduleStatus: scheduleUnavailable ? "stale" : "fresh",
    ...(allowBowlingDisplayContinuity ? { bowlingDisplay: bowlingDisplayMetadata(bowlingSnapshot, nowMs) } : {}),
    bowling: applySchedule("bowling", bowling),
    darts: applySchedule("darts", darts),
    pool: applySchedule("pool", pool),
    shuffleboard: applySchedule("shuffleboard", shuffleboard),
  };
}

/**
 * Refresh only slow remote sources. Route handlers register this with
 * `after()`, allowing Cloudflare's request waitUntil lifecycle to publish new
 * shared snapshots without delaying the response that triggered the refresh.
 */
export async function refreshLiveLaneSources(): Promise<void> {
  const now = Date.now();
  if (now < nextRemoteRefreshAt) return;
  // Claim the local window synchronously, before either source performs I/O.
  nextRemoteRefreshAt = now + REMOTE_REFRESH_THROTTLE_MS;
  await Promise.allSettled([
    getDartseeLaneSnapshot(),
    getEntertainmentSchedule(),
  ]);
}
