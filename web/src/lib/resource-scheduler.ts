import { defaultSessionMinutesFor } from "./booking";
import type { Activity, WaitlistEntry } from "./types";

export interface ResourceUnavailableWindow {
  startAtSeconds: number;
  endAtSeconds: number;
  reservationId: string;
  label: string;
  needsReview?: boolean;
}

export interface ResourceLaneAvailability {
  id: string;
  label: string;
  availableAtSeconds: number;
  unavailableWindows?: ResourceUnavailableWindow[];
}

export interface ResourceAssignment {
  entryId: string;
  name: string;
  laneCount: number;
  sessionMinutes: number;
  order: number;
  laneIds: string[];
  laneLabels: string[];
  startInSeconds: number;
  endInSeconds: number;
}

export interface ResourcePlan {
  assignments: ResourceAssignment[];
  unassigned: WaitlistEntry[];
}

function activeQueue(
  activity: Activity,
  entries: WaitlistEntry[],
  before?: WaitlistEntry,
): WaitlistEntry[] {
  let queue = entries.filter(
    (entry) =>
      entry.activity === activity &&
      (entry.status === "waiting" || entry.status === "notified"),
  );

  if (before) {
    const cutoff = new Date(before.createdAt).getTime();
    queue = queue.filter(
      (entry) => new Date(entry.createdAt).getTime() < cutoff,
    );
  }

  return queue.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function fifoWaitMinutes(parties: WaitlistEntry[]): number {
  return parties.reduce((sum, entry) => sum + entry.sessionMinutes, 0);
}

function makeWorkingLanes(lanes: ResourceLaneAvailability[]) {
  return lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    availableAtSeconds: Math.max(0, lane.availableAtSeconds),
    unavailableWindows: lane.unavailableWindows ?? [],
  }));
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const result: T[][] = [];
  for (let i = 0; i <= items.length - count; i += 1) {
    for (const rest of combinations(items.slice(i + 1), count - 1)) {
      result.push([items[i], ...rest]);
    }
  }
  return result;
}

function earliestCommonStart(
  lanes: ReturnType<typeof makeWorkingLanes>,
  durationSeconds: number,
): number {
  let start = Math.max(...lanes.map((lane) => lane.availableAtSeconds));
  for (let guard = 0; guard < 100; guard += 1) {
    let nextStart = start;
    for (const lane of lanes) {
      for (const window of lane.unavailableWindows) {
        if (start < window.endAtSeconds && start + durationSeconds > window.startAtSeconds) {
          nextStart = Math.max(nextStart, window.endAtSeconds);
        }
      }
    }
    if (nextStart === start) return start;
    start = nextStart;
  }
  return Number.POSITIVE_INFINITY;
}

export function hasUsableLaneAvailability(
  lanes: ResourceLaneAvailability[] | undefined,
  laneCount: number,
): lanes is ResourceLaneAvailability[] {
  if (!lanes?.length) return false;
  return (
    lanes.filter((lane) => Number.isFinite(lane.availableAtSeconds)).length >=
    laneCount
  );
}

export function planResourceQueue(
  entries: WaitlistEntry[],
  lanes: ResourceLaneAvailability[],
): ResourcePlan {
  const working = makeWorkingLanes(lanes);
  const assignments: ResourceAssignment[] = [];
  const unassigned: WaitlistEntry[] = [];

  for (const entry of entries) {
    const usable = working
      .filter((lane) => Number.isFinite(lane.availableAtSeconds))
      .sort((a, b) => {
        if (a.availableAtSeconds !== b.availableAtSeconds) {
          return a.availableAtSeconds - b.availableAtSeconds;
        }
        return a.label.localeCompare(b.label, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    if (usable.length < entry.laneCount) {
      unassigned.push(entry);
      continue;
    }

    const durationSeconds = entry.sessionMinutes * 60;
    const candidates = combinations(usable, entry.laneCount)
      .map((lanes) => ({ lanes, start: earliestCommonStart(lanes, durationSeconds) }))
      .sort((a, b) => a.start - b.start);
    const best = candidates[0];
    if (!best || !Number.isFinite(best.start)) {
      unassigned.push(entry);
      continue;
    }
    const selected = best.lanes;
    const startInSeconds = best.start;
    const endInSeconds = startInSeconds + durationSeconds;

    assignments.push({
      entryId: entry.id,
      name: entry.name,
      laneCount: entry.laneCount,
      sessionMinutes: entry.sessionMinutes,
      order: assignments.length + 1,
      laneIds: selected.map((lane) => lane.id),
      laneLabels: selected.map((lane) => lane.label),
      startInSeconds,
      endInSeconds,
    });

    for (const selectedLane of selected) {
      const lane = working.find((item) => item.id === selectedLane.id);
      if (lane) lane.availableAtSeconds = endInSeconds;
    }
  }

  return { assignments, unassigned };
}

export function activityQueueWait(
  activity: Activity,
  entries: WaitlistEntry[],
  lanes?: ResourceLaneAvailability[],
): number {
  const inLine = activeQueue(activity, entries);
  const hypothetical: WaitlistEntry = {
    id: "__new_guest__",
    activity,
    name: "New guest",
    phone: "",
    smsOptIn: false,
    laneCount: 1,
    sessionMinutes: defaultSessionMinutesFor(activity),
    status: "waiting",
    createdAt: "9999-12-31T23:59:59.999Z",
  };

  if (hasUsableLaneAvailability(lanes, hypothetical.laneCount)) {
    const plan = planResourceQueue([...inLine, hypothetical], lanes);
    const assignment = plan.assignments.find(
      (item) => item.entryId === hypothetical.id,
    );
    if (assignment && plan.unassigned.length === 0) {
      return Math.ceil(assignment.startInSeconds / 60);
    }
  }

  if (inLine.length === 0) return 0;
  return fifoWaitMinutes(inLine);
}

export function waitMinutesAhead(
  entries: WaitlistEntry[],
  target: WaitlistEntry,
  lanes?: ResourceLaneAvailability[],
): number {
  const ahead = activeQueue(target.activity, entries, target);

  if (hasUsableLaneAvailability(lanes, target.laneCount)) {
    const plan = planResourceQueue([...ahead, target], lanes);
    const assignment = plan.assignments.find(
      (item) => item.entryId === target.id,
    );
    if (assignment && plan.unassigned.length === 0) {
      return Math.ceil(assignment.startInSeconds / 60);
    }
  }

  return fifoWaitMinutes(ahead);
}

export { activeQueue, fifoWaitMinutes };
