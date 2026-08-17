import type { BowlingLaneReading, BowlingLaneSnapshot } from "./bowling-lanes";
import type { WaitlistEntry } from "./types";
import type { EntertainmentReservation } from "./entertainment-schedule";
import { addScheduleWindows } from "./entertainment-schedule";
import { planResourceQueue } from "./resource-scheduler";

const LANE_COUNT = 12;
const BOWLING_MAX_SNAPSHOT_AGE_MS = 120_000;

export interface PlannedBowlingLane extends BowlingLaneReading {
  availableAtSeconds: number;
  nextAssignmentId?: string;
}

export interface BowlingAssignment {
  entryId: string;
  name: string;
  laneCount: number;
  sessionMinutes: number;
  order: number;
  laneNumbers: number[];
  startInSeconds: number;
  endInSeconds: number;
}

export interface BowlingPlan {
  lanes: PlannedBowlingLane[];
  assignments: BowlingAssignment[];
  unassigned: WaitlistEntry[];
  updatedAt?: string;
  source?: string;
}

function secondsSince(iso?: string, nowMs = Date.now()): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((nowMs - ts) / 1000));
}

function activeBowlingQueue(entries: WaitlistEntry[]): WaitlistEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.activity === "bowling" &&
        (entry.status === "waiting" || entry.status === "notified"),
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

function laneAvailability(
  lane: BowlingLaneReading,
  elapsedSeconds: number,
): number {
  if (lane.status === "open") return 0;
  if (lane.status === "occupied") {
    return Math.max(0, lane.remainingSeconds - elapsedSeconds);
  }
  return Number.POSITIVE_INFINITY;
}

export function planBowlingAssignments(
  snapshot: BowlingLaneSnapshot | null,
  entries: WaitlistEntry[],
  nowMs = Date.now(),
  reservations: EntertainmentReservation[] = [],
): BowlingPlan {
  const elapsedSeconds = secondsSince(snapshot?.capturedAt, nowMs);
  const capturedAtMs = snapshot
    ? new Date(snapshot.capturedAt).getTime()
    : Number.NaN;
  const snapshotUnavailable =
    !snapshot ||
    snapshot.healthStatus !== "ok" ||
    !Number.isFinite(capturedAtMs) ||
    nowMs - capturedAtMs > BOWLING_MAX_SNAPSHOT_AGE_MS;
  const queue = activeBowlingQueue(entries);
  const baseLanes =
    snapshot?.lanes ??
    Array.from({ length: LANE_COUNT }, (_, i): BowlingLaneReading => ({
      lane: i + 1,
      status: "unknown",
      remainingSeconds: 0,
    }));
  const lanes = baseLanes.map((lane) => ({
    ...lane,
    remainingSeconds:
      lane.status === "occupied"
        ? Math.max(0, lane.remainingSeconds - elapsedSeconds)
        : 0,
    availableAtSeconds: snapshotUnavailable
      ? Number.POSITIVE_INFINITY
      : laneAvailability(lane, elapsedSeconds),
  }));

  const availability = addScheduleWindows("bowling", lanes.map((lane) => ({
    id: String(lane.lane),
    label: `Lane ${lane.lane}`,
    availableAtSeconds: lane.availableAtSeconds,
  })), reservations, nowMs);
  const resourcePlan = planResourceQueue(queue, availability);
  const assignments: BowlingAssignment[] = resourcePlan.assignments.map((assignment) => ({
    entryId: assignment.entryId,
    name: assignment.name,
    laneCount: assignment.laneCount,
    sessionMinutes: assignment.sessionMinutes,
    order: assignment.order,
    laneNumbers: assignment.laneIds.map(Number).sort((a, b) => a - b),
    startInSeconds: assignment.startInSeconds,
    endInSeconds: assignment.endInSeconds,
  }));

  const lanesWithNext = lanes.map((lane) => ({
    ...lane,
    nextAssignmentId: assignments.find((assignment) =>
      assignment.laneNumbers.includes(lane.lane),
    )?.entryId,
  }));

  return {
    lanes: lanesWithNext,
    assignments,
    unassigned: resourcePlan.unassigned,
    updatedAt: snapshot?.receivedAt,
    source: snapshot?.source,
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "Unknown";
  const whole = Math.max(0, Math.ceil(seconds / 60));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}:${String(mins).padStart(2, "0")}`;
  return `0:${String(mins).padStart(2, "0")}`;
}
