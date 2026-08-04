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
  const [bowlingResult, dartseeResult, timedResult] = await Promise.allSettled([
    getBowlingLaneSnapshot(),
    getDartseeLaneSnapshot(),
    getTimedResourceSessions(),
  ]);

  return {
    bowling:
      bowlingResult.status === "fulfilled"
        ? bowlingSnapshotToAvailability(bowlingResult.value)
        : undefined,
    darts:
      dartseeResult.status === "fulfilled"
        ? dartseeSnapshotToAvailability(dartseeResult.value)
        : undefined,
    pool:
      timedResult.status === "fulfilled"
        ? timedSessionsToAvailability("pool", timedResult.value)
        : undefined,
    shuffleboard:
      timedResult.status === "fulfilled"
        ? timedSessionsToAvailability("shuffleboard", timedResult.value)
        : undefined,
  };
}
