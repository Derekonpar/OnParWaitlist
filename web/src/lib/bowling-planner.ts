import type { BowlingLaneReading, BowlingLaneSnapshot } from "./bowling-lanes";
import type { WaitlistEntry } from "./types";

const LANE_COUNT = 12;

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
): BowlingPlan {
  const elapsedSeconds = secondsSince(snapshot?.capturedAt, nowMs);
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
    availableAtSeconds: laneAvailability(lane, elapsedSeconds),
  }));

  const working = lanes.map((lane) => ({
    laneNumber: lane.lane,
    availableAtSeconds: lane.availableAtSeconds,
  }));
  const assignments: BowlingAssignment[] = [];
  const unassigned: WaitlistEntry[] = [];

  for (const entry of queue) {
    const usable = working
      .filter((lane) => Number.isFinite(lane.availableAtSeconds))
      .sort((a, b) => {
        if (a.availableAtSeconds !== b.availableAtSeconds) {
          return a.availableAtSeconds - b.availableAtSeconds;
        }
        return a.laneNumber - b.laneNumber;
      });

    if (usable.length < entry.laneCount) {
      unassigned.push(entry);
      continue;
    }

    const selected = usable.slice(0, entry.laneCount);
    const startInSeconds = Math.max(
      ...selected.map((lane) => lane.availableAtSeconds),
    );
    const endInSeconds = startInSeconds + entry.sessionMinutes * 60;
    const laneNumbers = selected
      .map((lane) => lane.laneNumber)
      .sort((a, b) => a - b);

    assignments.push({
      entryId: entry.id,
      name: entry.name,
      laneCount: entry.laneCount,
      sessionMinutes: entry.sessionMinutes,
      order: assignments.length + 1,
      laneNumbers,
      startInSeconds,
      endInSeconds,
    });

    for (const lane of selected) {
      const workLane = working.find(
        (item) => item.laneNumber === lane.laneNumber,
      );
      if (workLane) workLane.availableAtSeconds = endInSeconds;
    }
  }

  const lanesWithNext = lanes.map((lane) => ({
    ...lane,
    nextAssignmentId: assignments.find((assignment) =>
      assignment.laneNumbers.includes(lane.lane),
    )?.entryId,
  }));

  return {
    lanes: lanesWithNext,
    assignments,
    unassigned,
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
