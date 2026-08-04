import type { DartseeLaneReading, DartseeLaneSnapshot } from "./dartsee-lanes";
import { planResourceQueue } from "./resource-scheduler";
import type { WaitlistEntry } from "./types";

const DARTSEE_LANE_COUNT = 6;

export interface PlannedDartseeLane extends DartseeLaneReading {
  availableAtSeconds: number;
  nextAssignmentId?: string;
}

export interface DartseeAssignment {
  entryId: string;
  name: string;
  laneCount: number;
  sessionMinutes: number;
  order: number;
  boardIds: string[];
  laneNumbers: number[];
  startInSeconds: number;
  endInSeconds: number;
}

export interface DartseePlan {
  lanes: PlannedDartseeLane[];
  assignments: DartseeAssignment[];
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

function activeDartsQueue(entries: WaitlistEntry[]): WaitlistEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.activity === "darts" &&
        (entry.status === "waiting" || entry.status === "notified"),
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

function laneAvailability(
  lane: DartseeLaneReading,
  elapsedSeconds: number,
): number {
  if (lane.status === "open") return 0;
  if (lane.status === "occupied") {
    return Math.max(0, lane.remainingSeconds - elapsedSeconds);
  }
  return Number.POSITIVE_INFINITY;
}

function fallbackLanes(): DartseeLaneReading[] {
  return Array.from({ length: DARTSEE_LANE_COUNT }, (_, i) => ({
    lane: i + 1,
    boardId: `dart-${i + 1}`,
    name: `Dart ${i + 1}`,
    status: "unknown",
    remainingSeconds: 0,
  }));
}

export function planDartseeAssignments(
  snapshot: DartseeLaneSnapshot | null,
  entries: WaitlistEntry[],
  nowMs = Date.now(),
): DartseePlan {
  const elapsedSeconds = secondsSince(snapshot?.capturedAt, nowMs);
  const queue = activeDartsQueue(entries);
  const baseLanes = snapshot?.lanes ?? fallbackLanes();
  const lanes = baseLanes.map((lane) => ({
    ...lane,
    remainingSeconds:
      lane.status === "occupied"
        ? Math.max(0, lane.remainingSeconds - elapsedSeconds)
        : 0,
    availableAtSeconds: laneAvailability(lane, elapsedSeconds),
  }));

  const plan = planResourceQueue(
    queue,
    lanes.map((lane) => ({
      id: lane.boardId,
      label: `Dart ${lane.lane}`,
      availableAtSeconds: lane.availableAtSeconds,
    })),
  );

  const assignments = plan.assignments.map((assignment) => {
    const assignedLanes = assignment.laneIds
      .map((id) => lanes.find((lane) => lane.boardId === id))
      .filter((lane): lane is PlannedDartseeLane => Boolean(lane));

    return {
      entryId: assignment.entryId,
      name: assignment.name,
      laneCount: assignment.laneCount,
      sessionMinutes: assignment.sessionMinutes,
      order: assignment.order,
      boardIds: assignment.laneIds,
      laneNumbers: assignedLanes
        .map((lane) => lane.lane)
        .sort((a, b) => a - b),
      startInSeconds: assignment.startInSeconds,
      endInSeconds: assignment.endInSeconds,
    };
  });

  const lanesWithNext = lanes.map((lane) => ({
    ...lane,
    nextAssignmentId: assignments.find((assignment) =>
      assignment.boardIds.includes(lane.boardId),
    )?.entryId,
  }));

  return {
    lanes: lanesWithNext,
    assignments,
    unassigned: plan.unassigned,
    updatedAt: snapshot?.receivedAt,
    source: snapshot?.source,
  };
}
