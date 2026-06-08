import type { Activity, WaitlistEntry } from "./types";

export function partyWaitMinutes(entry: {
  sessionMinutes: number;
  laneCount: number;
}): number {
  const lanes = Math.max(1, entry.laneCount);
  return Math.ceil(entry.sessionMinutes / lanes);
}

export function queueWaitMinutes(entries: WaitlistEntry[]): number {
  return entries.reduce((sum, entry) => sum + partyWaitMinutes(entry), 0);
}

export function waitMinutesAhead(
  entries: WaitlistEntry[],
  target: WaitlistEntry,
): number {
  const ahead = entries.filter(
    (e) =>
      e.activity === target.activity &&
      e.status === "waiting" &&
      new Date(e.createdAt).getTime() < new Date(target.createdAt).getTime(),
  );
  return queueWaitMinutes(ahead);
}

export function activityQueueWait(
  activity: Activity,
  entries: WaitlistEntry[],
): number {
  const waiting = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  return queueWaitMinutes(waiting);
}

export function formatSessionLabel(minutes: number): string {
  return minutes === 60 ? "1 hour" : "30 min";
}
