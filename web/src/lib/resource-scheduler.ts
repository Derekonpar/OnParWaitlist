import { defaultSessionMinutesFor } from "./booking";
import { BOWLING_CLEANING_BUFFER_SECONDS } from "./bowling-turnover";
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
  return parties.reduce(
    (sum, entry) =>
      sum +
      entry.sessionMinutes +
      activityTurnoverSeconds(entry.activity) / 60,
    0,
  );
}

export function activityTurnoverSeconds(activity: Activity): number {
  return activity === "bowling" ? BOWLING_CLEANING_BUFFER_SECONDS : 0;
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

function adjacentResources(lanes: { id: string }[]): boolean {
  if (lanes.length <= 1) return true;
  const numbers = lanes
    .map((lane) => Number(lane.id))
    .sort((a, b) => a - b);
  if (numbers.some((value) => !Number.isInteger(value))) return true;
  return numbers.every(
    (value, index) => index === 0 || value === numbers[index - 1] + 1,
  );
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

function newGuestFor(activity: Activity): WaitlistEntry {
  return {
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
    const turnoverSeconds = activityTurnoverSeconds(entry.activity);
    const candidates = combinations(usable, entry.laneCount)
      // A multi-lane party must start together on physically adjacent lanes.
      // If no adjacent group is ready, keep the party waiting for one.
      .filter(adjacentResources)
      .map((lanes) => {
        const start = earliestCommonStart(
          lanes,
          durationSeconds + turnoverSeconds,
        );
        return {
          lanes,
          start,
          // Among combinations that start at the same time, preserve lanes
          // that have been free longer. For example, prefer a 5-6 pair that
          // both free in 40 minutes over 4-5 when lane 4 frees in 10 minutes.
          // The earlier lane can then serve a one-lane guest without delaying
          // the multi-lane party or violating FIFO.
          idleLaneSeconds: lanes.reduce(
            (sum, lane) => sum + Math.max(0, start - lane.availableAtSeconds),
            0,
          ),
          laneKey: lanes
            .map((lane) => lane.id)
            .sort((left, right) =>
              left.localeCompare(right, undefined, { numeric: true }),
            )
            .join(":"),
        };
      })
      .sort(
        (a, b) =>
          a.start - b.start ||
          a.idleLaneSeconds - b.idleLaneSeconds ||
          a.laneKey.localeCompare(b.laneKey, undefined, { numeric: true }),
      );
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
      if (lane) {
        lane.availableAtSeconds = endInSeconds + turnoverSeconds;
      }
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
  const hypothetical = newGuestFor(activity);

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

/**
 * A public activity estimate is live only when the same plan used for the
 * estimate can place every queued party and the next hypothetical party. A
 * partially responding lane feed must not turn a FIFO fallback into a
 * seemingly live estimate.
 */
export function hasCompleteActivityAvailability(
  activity: Activity,
  entries: WaitlistEntry[],
  lanes?: ResourceLaneAvailability[],
): boolean {
  const inLine = activeQueue(activity, entries);
  const hypothetical = newGuestFor(activity);
  if (!hasUsableLaneAvailability(lanes, hypothetical.laneCount)) return false;
  const plan = planResourceQueue([...inLine, hypothetical], lanes);
  return (
    plan.unassigned.length === 0 &&
    plan.assignments.some((assignment) => assignment.entryId === hypothetical.id)
  );
}

/** Return true only when a guest's exact multi-resource plan is assignable. */
export function hasCompleteTargetAvailability(
  entries: WaitlistEntry[],
  target: WaitlistEntry,
  lanes?: ResourceLaneAvailability[],
): boolean {
  if (target.status !== "waiting") return true;
  const ahead = activeQueue(target.activity, entries, target);
  if (!hasUsableLaneAvailability(lanes, target.laneCount)) return false;
  const plan = planResourceQueue([...ahead, target], lanes);
  return (
    plan.unassigned.length === 0 &&
    plan.assignments.some((assignment) => assignment.entryId === target.id)
  );
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
