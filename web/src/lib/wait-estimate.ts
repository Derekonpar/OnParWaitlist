import type { Activity, WaitlistEntry } from "./types";

/** Parties in line ahead of a guest (FIFO order). */
function partiesInLine(
  activity: Activity,
  entries: WaitlistEntry[],
  before?: WaitlistEntry,
): WaitlistEntry[] {
  let list = entries.filter(
    (e) =>
      e.activity === activity &&
      (e.status === "waiting" || e.status === "notified"),
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

/**
 * Waitlist lines are FIFO: each party waits for everyone ahead to finish
 * their booked session (full session length, not divided by lane count).
 */
function fifoWaitMinutes(parties: WaitlistEntry[]): number {
  return parties.reduce((sum, entry) => sum + entry.sessionMinutes, 0);
}

/** Estimated wait if a new guest joined this activity right now. */
export function activityQueueWait(
  activity: Activity,
  entries: WaitlistEntry[],
): number {
  const inLine = partiesInLine(activity, entries);
  if (inLine.length === 0) return 0;
  return fifoWaitMinutes(inLine);
}

export function waitMinutesAhead(
  entries: WaitlistEntry[],
  target: WaitlistEntry,
): number {
  const ahead = partiesInLine(target.activity, entries, target);
  return fifoWaitMinutes(ahead);
}

export { formatSessionLabel } from "./booking";
