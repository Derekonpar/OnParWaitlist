import type { DartseeSnapshotVersion } from "./dartsee-snapshot-order";

export type DartseeGuardedLaneStatus = "open" | "occupied" | "unknown";

export interface DartseeControlGuard {
  confirmedAt: string;
  expiresAt: string;
  expectedStatus: "open" | "occupied";
  expectedSessionId?: string;
  supersededSessionId?: string;
}

export interface DartseeGuardedLane {
  boardId: string;
  status: DartseeGuardedLaneStatus;
  remainingSeconds: number;
  sessionId?: string;
  sessionEnd?: string;
  gameType?: string;
  observedAt?: string;
  controlGuard?: DartseeControlGuard;
}

export interface DartseeGuardedSnapshot<
  Lane extends DartseeGuardedLane = DartseeGuardedLane,
> extends DartseeSnapshotVersion {
  lanes: Lane[];
}

export const DARTSEE_CONTROL_GUARD_MS = 60_000;

function parsedMs(value: string | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function withoutControlGuard<Lane extends DartseeGuardedLane>(lane: Lane): Lane {
  const unguarded = { ...lane };
  delete unguarded.controlGuard;
  return unguarded;
}

function rebaseLane<Lane extends DartseeGuardedLane>(
  lane: Lane,
  fromMs: number,
  toMs: number,
): Lane {
  if (lane.status !== "occupied") return { ...lane };
  const elapsedSeconds =
    Number.isFinite(fromMs) && Number.isFinite(toMs)
      ? Math.max(0, Math.floor((toMs - fromMs) / 1000))
      : 0;
  const remainingSeconds = Math.max(
    0,
    lane.remainingSeconds - elapsedSeconds,
  );
  if (remainingSeconds > 0) return { ...lane, remainingSeconds };
  return {
    ...lane,
    status: "open",
    remainingSeconds: 0,
    sessionId: undefined,
    sessionEnd: undefined,
    gameType: undefined,
  };
}

function laneConfirmsGuard(
  lane: DartseeGuardedLane,
  guard: DartseeControlGuard,
): boolean {
  if (guard.expectedStatus === "open") return lane.status === "open";
  if (lane.status !== "occupied") return false;
  return (
    !guard.expectedSessionId || lane.sessionId === guard.expectedSessionId
  );
}

function laneIsDistinctLaterSession(
  lane: DartseeGuardedLane,
  guard: DartseeControlGuard,
): boolean {
  if (lane.status !== "occupied" || !lane.sessionId) return false;
  const priorSessionId =
    guard.expectedStatus === "occupied"
      ? guard.expectedSessionId
      : guard.supersededSessionId;
  return Boolean(priorSessionId && lane.sessionId !== priorSessionId);
}

/**
 * Retain an exactly-confirmed control state while Dartsee's new dashboard
 * socket is still echoing its pre-control cache. Matching live state removes
 * the guard immediately; a distinct session or guard expiry permits a genuine
 * later change.
 */
export function mergeDartseeControlGuards<
  Lane extends DartseeGuardedLane,
  Snapshot extends DartseeGuardedSnapshot<Lane>,
>(incoming: Snapshot, previous: Snapshot | null): Snapshot {
  if (!previous) return incoming;
  const previousByBoard = new Map(
    previous.lanes.map((lane) => [lane.boardId, lane]),
  );
  const incomingEvidenceMs = Math.max(
    parsedMs(incoming.stateVersionAt),
    parsedMs(incoming.capturedAt),
  );
  const previousCaptureMs = parsedMs(previous.capturedAt);
  const incomingCaptureMs = parsedMs(incoming.capturedAt);

  let changed = false;
  const lanes = incoming.lanes.map((lane) => {
    const prior = previousByBoard.get(lane.boardId);
    const guard = prior?.controlGuard;
    if (!prior || !guard) return lane;

    const incomingGuardAt = parsedMs(lane.controlGuard?.confirmedAt);
    const priorGuardAt = parsedMs(guard.confirmedAt);
    if (incomingGuardAt > priorGuardAt) return lane;

    if (
      laneConfirmsGuard(lane, guard) ||
      laneIsDistinctLaterSession(lane, guard) ||
      incomingEvidenceMs >= parsedMs(guard.expiresAt)
    ) {
      changed = changed || Boolean(lane.controlGuard);
      return withoutControlGuard(lane);
    }

    changed = true;
    return rebaseLane(prior, previousCaptureMs, incomingCaptureMs);
  });

  return changed ? { ...incoming, lanes } : incoming;
}

/** Build a complete, countdown-rebased snapshot around one confirmed lane. */
export function snapshotWithConfirmedDartseeControl<
  Lane extends DartseeGuardedLane,
  Snapshot extends DartseeGuardedSnapshot<Lane>,
>(
  previous: Snapshot,
  confirmedLane: Lane,
  confirmedAtMs: number,
  publishedAtMs = Date.now(),
): Snapshot {
  const priorLane = previous.lanes.find(
    (lane) => lane.boardId === confirmedLane.boardId,
  );
  if (!priorLane) return previous;

  const safePublishedAtMs = Math.max(publishedAtMs, confirmedAtMs);
  const publishedAt = new Date(safePublishedAtMs).toISOString();
  const confirmedAt = new Date(confirmedAtMs).toISOString();
  const controlGuard: DartseeControlGuard = {
    confirmedAt,
    expiresAt: new Date(
      confirmedAtMs + DARTSEE_CONTROL_GUARD_MS,
    ).toISOString(),
    expectedStatus:
      confirmedLane.status === "occupied" ? "occupied" : "open",
    ...(confirmedLane.status === "occupied" && confirmedLane.sessionId
      ? { expectedSessionId: confirmedLane.sessionId }
      : {}),
    ...(confirmedLane.status === "open" && priorLane.sessionId
      ? { supersededSessionId: priorLane.sessionId }
      : {}),
  };
  const previousCaptureMs = parsedMs(previous.capturedAt);
  const lanes = previous.lanes.map((lane) => {
    if (lane.boardId !== confirmedLane.boardId) {
      return rebaseLane(lane, previousCaptureMs, safePublishedAtMs);
    }
    return {
      ...rebaseLane(confirmedLane, confirmedAtMs, safePublishedAtMs),
      observedAt: confirmedAt,
      controlGuard,
    } as Lane;
  });

  return {
    ...previous,
    lanes,
    capturedAt: publishedAt,
    stateVersionAt: publishedAt,
    receivedAt: publishedAt,
  };
}
