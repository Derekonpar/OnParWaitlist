import type { BowlingLaneReading, BowlingLaneSnapshot } from "./bowling-lanes";
import type { EntertainmentReservation } from "./entertainment-schedule";
import { addScheduleWindows } from "./entertainment-schedule";
import { BOWLING_CLEANING_BUFFER_SECONDS } from "./bowling-turnover";
import { activeQueue, planResourceQueue } from "./resource-scheduler";
import type { WaitlistEntry } from "./types";

/** Public estimates only. Never use these retained readings to start/place a lane. */
export interface BowlingDisplayReading {
  status: "open" | "occupied" | "reserved";
  observedAt: string;
  availableAt: string | null;
}

// Retain this operating session, not yesterday's apparent availability.
export const BOWLING_ESTIMATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const parse = (value?: string | null) => value && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  ? Date.parse(value) : Number.NaN;

function validReading(value: BowlingDisplayReading | undefined, nowMs: number) {
  if (!value || !["open", "occupied", "reserved"].includes(value.status)) return undefined;
  const observed = parse(value.observedAt);
  const ready = parse(value.availableAt);
  if (!Number.isFinite(observed) || observed > nowMs || nowMs - observed >= BOWLING_ESTIMATE_MAX_AGE_MS) return undefined;
  if (value.status !== "reserved" && (!Number.isFinite(ready) || ready > observed + 13 * 60 * 60 * 1000)) return undefined;
  return value;
}

function positiveReading(snapshot: BowlingLaneSnapshot, lane: BowlingLaneReading, nowMs: number) {
  const captured = parse(snapshot.capturedAt);
  const observed = parse(lane.observedAt ?? snapshot.capturedAt);
  if (lane.estimated || lane.status === "unknown" || !Number.isFinite(captured) || captured > nowMs ||
      !Number.isFinite(observed) || observed > captured || nowMs - observed >= BOWLING_ESTIMATE_MAX_AGE_MS ||
      !Number.isFinite(lane.remainingSeconds) || lane.remainingSeconds < 0 || lane.remainingSeconds > 43200) return undefined;
  return validReading({
    status: lane.status,
    observedAt: new Date(observed).toISOString(),
    availableAt: lane.status === "reserved" ? null : new Date(lane.status === "open" ? observed :
      captured + (lane.remainingSeconds + BOWLING_CLEANING_BUFFER_SECONDS) * 1000).toISOString(),
  }, nowMs);
}

/** Stored inside the existing lane JSON: no new table and no guest-data writes. */
export function retainBowlingDisplayReadings(
  next: BowlingLaneSnapshot, previous: BowlingLaneSnapshot | null, nowMs = Date.now(),
): BowlingLaneSnapshot {
  return { ...next, lanes: next.lanes.map((lane) => {
    const priorLane = previous?.lanes.find((item) => item.lane === lane.lane);
    const prior = validReading(priorLane?.displayReading, nowMs) ??
      (previous && priorLane ? positiveReading(previous, priorLane, nowMs) : undefined);
    const observed = positiveReading(next, lane, nowMs);
    let displayReading = observed ?? prior;
    if (prior && observed && parse(observed.observedAt) < parse(prior.observedAt)) displayReading = prior;
    else if (prior?.status === "open" && observed?.status === "open") {
      // An unchanged open lane must not push queued parties' predicted start
      // forward on every ten-second snapshot.
      displayReading = { ...observed, availableAt: prior.availableAt };
    }
    return { ...lane, displayReading };
  }) };
}

/** Absolute-time queue planning so a retained snapshot never restarts a wait. */
export function projectBowlingWait(
  snapshot: BowlingLaneSnapshot | null,
  reservations: EntertainmentReservation[],
  entries: WaitlistEntry[],
  nowMs = Date.now(),
  target?: WaitlistEntry,
) {
  if (!snapshot) return undefined;
  const readings = snapshot.lanes.map((lane) => ({ lane,
    reading: validReading(lane.displayReading, nowMs) ?? positiveReading(snapshot, lane, nowMs),
  }));
  const usable = readings.filter((item) => item.reading && item.reading.status !== "reserved");
  if (!usable.length) return undefined;
  const queue = activeQueue("bowling", entries, target);
  const guest: WaitlistEntry = target ?? {
    id: "__new_guest__", name: "", phone: "", smsOptIn: false, activity: "bowling",
    laneCount: 1, sessionMinutes: 60, status: "waiting", createdAt: new Date(nowMs).toISOString(),
  };
  const planned = [...queue, guest];
  const created = planned.map((entry) => parse(entry.createdAt));
  if (created.some((value) => !Number.isFinite(value) || value > nowMs)) return undefined;
  const baseMs = Math.min(nowMs, ...created, ...usable.map(({ reading }) => parse(reading!.availableAt)));
  const lanes = addScheduleWindows("bowling", readings.map(({ lane, reading }) => ({
    id: String(lane.lane), label: `Lane ${lane.lane}`,
    availableAtSeconds: reading && reading.status !== "reserved"
      ? Math.max(0, (parse(reading.availableAt) - baseMs) / 1000) : Number.POSITIVE_INFINITY,
  })), reservations, baseMs);
  const plan = planResourceQueue(planned, lanes, Object.fromEntries(planned.map((entry, index) =>
    [entry.id, Math.max(0, (created[index] - baseMs) / 1000)])));
  const assignment = plan.assignments.find((item) => item.entryId === guest.id);
  if (!assignment || plan.unassigned.length) return undefined;
  const readyMs = baseMs + assignment.startInSeconds * 1000;
  const sourceAt = Math.min(...usable.map(({ reading }) => parse(reading!.observedAt)));
  return {
    estimatedWaitMinutes: Math.max(0, Math.ceil((readyMs - nowMs) / 60000)),
    waitReadyAt: new Date(readyMs).toISOString(),
    waitSourceAt: new Date(sourceAt).toISOString(),
    waitEstimateExpiresAt: new Date(sourceAt + BOWLING_ESTIMATE_MAX_AGE_MS).toISOString(),
    availabilityStatus: "estimated" as const,
  };
}
