import {
  getBowlingLaneSnapshot,
  type BowlingLaneSnapshot,
} from "./bowling-lanes";
import {
  dartseeSnapshotToAvailability,
  getDartseeLaneSnapshot,
} from "./dartsee-lanes";
import type { ResourceLaneAvailability } from "./resource-scheduler";
import {
  getTimedResourceSessions,
  timedSessionsToAvailability,
} from "./resource-sessions";
import type { Activity } from "./types";
import { addScheduleWindows, getEntertainmentSchedule } from "./entertainment-schedule";

export type LiveLaneAvailability = Partial<
  Record<Activity, ResourceLaneAvailability[]>
>;

function elapsedSeconds(iso?: string, nowMs = Date.now()): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((nowMs - ts) / 1000));
}

export function bowlingSnapshotToAvailability(
  snapshot: BowlingLaneSnapshot | null,
  nowMs = Date.now(),
): ResourceLaneAvailability[] | undefined {
  if (!snapshot) return undefined;
  const elapsed = elapsedSeconds(snapshot.capturedAt, nowMs);
  return snapshot.lanes.map((lane) => ({
    id: String(lane.lane),
    label: `Lane ${lane.lane}`,
    availableAtSeconds:
      lane.status === "open"
        ? 0
        : lane.status === "occupied"
          ? Math.max(0, lane.remainingSeconds - elapsed)
          : Number.POSITIVE_INFINITY,
  }));
}

export async function getLiveLaneAvailability(): Promise<LiveLaneAvailability> {
  const [bowlingResult, dartseeResult, timedResult, scheduleResult] = await Promise.allSettled([
    getBowlingLaneSnapshot(),
    getDartseeLaneSnapshot(),
    getTimedResourceSessions(),
    getEntertainmentSchedule(),
  ]);

  const reservations = scheduleResult.status === "fulfilled"
    ? (scheduleResult.value?.reservations ?? [])
    : [];
  const bowling = bowlingResult.status === "fulfilled"
    ? bowlingSnapshotToAvailability(bowlingResult.value)
    : undefined;
  const darts = dartseeResult.status === "fulfilled"
    ? dartseeSnapshotToAvailability(dartseeResult.value)
    : undefined;
  const pool = timedResult.status === "fulfilled"
    ? timedSessionsToAvailability("pool", timedResult.value)
    : undefined;
  const shuffleboard = timedResult.status === "fulfilled"
    ? timedSessionsToAvailability("shuffleboard", timedResult.value)
    : undefined;

  return {
    bowling: bowling ? addScheduleWindows("bowling", bowling, reservations) : undefined,
    darts: darts ? addScheduleWindows("darts", darts, reservations) : undefined,
    pool: pool ? addScheduleWindows("pool", pool, reservations) : undefined,
    shuffleboard: shuffleboard
      ? addScheduleWindows("shuffleboard", shuffleboard, reservations)
      : undefined,
  };
}
