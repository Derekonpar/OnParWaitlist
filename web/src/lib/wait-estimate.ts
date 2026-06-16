import { ACTIVITY_CAPACITY } from "./booking";
import type { Activity, WaitlistEntry } from "./types";

export interface WaitRequest {
  laneCount: number;
  sessionMinutes: number;
}

/** When each lane/table becomes free (minutes from now). */
function assignParty(
  laneEnds: number[],
  laneCount: number,
  sessionMinutes: number,
): number {
  const capacity = laneEnds.length;
  const need = Math.min(Math.max(1, laneCount), capacity);
  const indexed = laneEnds
    .map((endAt, index) => ({ endAt, index }))
    .sort((a, b) => a.endAt - b.endAt);
  const startAt = indexed[need - 1].endAt;
  const endAt = startAt + sessionMinutes;
  for (let i = 0; i < need; i++) {
    laneEnds[indexed[i].index] = endAt;
  }
  return startAt;
}

/**
 * Simulate lane/table scheduling: each party blocks `laneCount` resources
 * for the full `sessionMinutes` (not divided by lane count).
 */
export function simulateWaitMinutes(
  capacity: number,
  partiesAhead: WaitRequest[],
  request: WaitRequest,
): number {
  if (capacity < 1) return 0;

  const laneEnds = Array.from({ length: capacity }, () => 0);

  for (const party of partiesAhead) {
    assignParty(laneEnds, party.laneCount, party.sessionMinutes);
  }

  return Math.ceil(assignParty(laneEnds, request.laneCount, request.sessionMinutes));
}

function waitingEntries(
  activity: Activity,
  entries: WaitlistEntry[],
  before?: WaitlistEntry,
): WaitlistEntry[] {
  let list = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  if (before) {
    const cutoff = new Date(before.createdAt).getTime();
    list = list.filter(
      (e) => new Date(e.createdAt).getTime() < cutoff,
    );
  }
  return list.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function estimateWaitMinutes(
  activity: Activity,
  entries: WaitlistEntry[],
  request: WaitRequest,
  before?: WaitlistEntry,
): number {
  const ahead = waitingEntries(activity, entries, before).map((e) => ({
    laneCount: e.laneCount,
    sessionMinutes: e.sessionMinutes,
  }));
  return simulateWaitMinutes(ACTIVITY_CAPACITY[activity], ahead, request);
}

/** Default board estimate: 1 lane/table, 30-minute session. */
export function activityQueueWait(
  activity: Activity,
  entries: WaitlistEntry[],
): number {
  const waiting = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  if (waiting.length === 0) return 0;
  return estimateWaitMinutes(activity, entries, {
    laneCount: 1,
    sessionMinutes: 30,
  });
}

export function waitMinutesAhead(
  entries: WaitlistEntry[],
  target: WaitlistEntry,
): number {
  return estimateWaitMinutes(
    target.activity,
    entries,
    {
      laneCount: target.laneCount,
      sessionMinutes: target.sessionMinutes,
    },
    target,
  );
}

export { formatSessionLabel } from "./booking";
