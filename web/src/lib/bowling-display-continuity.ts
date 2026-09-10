import type { BowlingLaneReading, BowlingLaneSnapshot, BowlingLaneStatus } from "./bowling-lanes";
import type { ActivityStats } from "./types";

/** Display grace only. Booking/assignment freshness remains independently strict. */
export const BOWLING_DISPLAY_GRACE_MS = 180_000;
const STRICT_SNAPSHOT_AGE_MS = 120_000;

function timestamp(value: string | undefined): number {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return Number.NaN;
  return Date.parse(value);
}

function freshAt(value: number, nowMs: number, maxAgeMs: number, inclusive = true): boolean {
  return Number.isFinite(value) && Number.isFinite(nowMs) && value <= nowMs &&
    (inclusive ? nowMs - value <= maxAgeMs : nowMs - value < maxAgeMs);
}

/** A new snapshot must not renew an estimated lane's original OCR evidence. */
export function bowlingLaneEvidenceFresh(
  snapshot: BowlingLaneSnapshot,
  lane: BowlingLaneReading,
  nowMs: number,
  maxAgeMs = STRICT_SNAPSHOT_AGE_MS,
): boolean {
  const captureMs = timestamp(snapshot.capturedAt);
  const observedMs = timestamp(lane.observedAt ?? (lane.estimated ? undefined : snapshot.capturedAt));
  const inclusive = maxAgeMs !== BOWLING_DISPLAY_GRACE_MS;
  return freshAt(captureMs, nowMs, maxAgeMs, inclusive) && freshAt(observedMs, nowMs, maxAgeMs, inclusive) && observedMs <= captureMs;
}

export function bowlingSnapshotDisplayState(snapshot: BowlingLaneSnapshot | null, nowMs: number) {
  const capturedMs = timestamp(snapshot?.capturedAt);
  const available = Boolean(snapshot && freshAt(capturedMs, nowMs, BOWLING_DISPLAY_GRACE_MS, false));
  return {
    available,
    reconnecting: available && (snapshot!.healthStatus !== "ok" || nowMs - capturedMs > STRICT_SNAPSHOT_AGE_MS),
  };
}

export function bowlingLaneDisplayStatus(
  snapshot: BowlingLaneSnapshot | null,
  lane: BowlingLaneReading,
  nowMs: number,
): BowlingLaneStatus {
  if (!snapshot || !bowlingSnapshotDisplayState(snapshot, nowMs).available ||
      !bowlingLaneEvidenceFresh(snapshot, lane, nowMs, BOWLING_DISPLAY_GRACE_MS)) return "unknown";
  // Only occupied state may be carried across an ambiguous OCR frame. In
  // particular, a retained timer reaching zero never proves that a lane opened.
  if (lane.estimated && lane.status !== "occupied") return "unknown";
  return lane.status;
}

export function bowlingDisplayMetadata(snapshot: BowlingLaneSnapshot | null, nowMs: number) {
  const state = bowlingSnapshotDisplayState(snapshot, nowMs);
  if (!snapshot || !state.available) return undefined;
  const evidence = snapshot.lanes
    .filter((lane) => bowlingLaneDisplayStatus(snapshot, lane, nowMs) !== "unknown")
    .map((lane) => timestamp(lane.observedAt ?? snapshot.capturedAt));
  if (!evidence.length) return undefined;
  return {
    estimated: state.reconnecting || snapshot.lanes.some((lane) => lane.estimated === true || !bowlingLaneEvidenceFresh(snapshot, lane, nowMs)),
    // The browser must also age out a retained API response when polling fails.
    expiresAt: new Date(Math.min(timestamp(snapshot.capturedAt), ...evidence) + BOWLING_DISPLAY_GRACE_MS).toISOString(),
  };
}

/** Pure rendering policy; this must never authorize booking or device actions. */
export function publicWaitDisplayStatus(stats: ActivityStats, nowMs: number): ActivityStats["availabilityStatus"] {
  if (stats.availabilityExpiresAt && !freshAt(timestamp(stats.availabilityExpiresAt) - BOWLING_DISPLAY_GRACE_MS, nowMs, BOWLING_DISPLAY_GRACE_MS, false)) return "unknown";
  if (stats.availabilityStatus === "estimated" && !stats.availabilityExpiresAt) return "unknown";
  return stats.availabilityStatus === "live" || stats.availabilityStatus === "estimated" ? stats.availabilityStatus : "unknown";
}
