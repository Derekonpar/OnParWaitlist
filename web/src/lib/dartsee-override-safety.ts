export interface DartseeOverrideSafetyLane {
  boardId: string;
  status: "open" | "occupied" | "unknown";
  sessionId?: string;
  sessionEnd?: string;
  maxPlayers?: number;
}

export type DartseeOverrideInspection =
  | { ok: true; action: "start" }
  | {
      ok: true;
      action: "extend";
      sessionId: string;
      currentEndMs: number;
      maxPlayers: number;
    }
  | {
      ok: false;
      reason:
        | "target-missing"
        | "feed-unavailable"
        | "session-unavailable"
        | "shared-session";
    };

export const DARTSEE_EXTEND_CONFIRM_END_TOLERANCE_MS = 10_000;

const DEFINITIVE_OVERRIDE_REJECTION_STATUSES = new Set([
  400,
  401,
  403,
  404,
  409,
  422,
]);

/**
 * Only statuses that explicitly and definitively reject this exact request may
 * release the duplicate-control lease without live verification. Redirects,
 * timeouts, throttling, and upstream failures are ambiguous after a POST.
 */
export function isDefinitiveDartseeOverrideRejection(status: number): boolean {
  return DEFINITIVE_OVERRIDE_REJECTION_STATUSES.has(status);
}

/**
 * Prove an extension from the exact live session and its end time. Re-observing
 * the old end—or a tiny clock drift near it—is not evidence that Dartsee added
 * the requested minutes.
 */
export function dartseeExtensionConfirmationMatches(
  lane: DartseeOverrideSafetyLane | null,
  sessionId: string,
  previousEndMs: number,
  expectedEndMs: number,
  toleranceMs = DARTSEE_EXTEND_CONFIRM_END_TOLERANCE_MS,
): lane is DartseeOverrideSafetyLane {
  if (
    !lane ||
    lane.status !== "occupied" ||
    lane.sessionId !== sessionId ||
    !lane.sessionEnd ||
    !Number.isFinite(previousEndMs) ||
    !Number.isFinite(expectedEndMs) ||
    !Number.isFinite(toleranceMs) ||
    toleranceMs < 0
  ) {
    return false;
  }
  const endMs = new Date(lane.sessionEnd).getTime();
  return (
    Number.isFinite(endMs) &&
    endMs > previousEndMs &&
    Math.abs(endMs - expectedEndMs) <= toleranceMs
  );
}

function normalizedSessionId(
  lane: DartseeOverrideSafetyLane,
): string | null {
  const value = lane.sessionId?.trim();
  return value ? value : null;
}

/**
 * Decide an override from a complete live venue snapshot. The browser never
 * chooses the physical operation: an open target starts a new walk-in, while
 * an occupied target may be extended only when it is one exact single-board
 * session with a readable end time and player limit.
 */
export function inspectDartseeOverrideLane(
  lanes: DartseeOverrideSafetyLane[],
  boardId: string,
  nowMs = Date.now(),
): DartseeOverrideInspection {
  const target = lanes.find((lane) => lane.boardId === boardId);
  if (!target) return { ok: false, reason: "target-missing" };
  if (target.status === "unknown") {
    return { ok: false, reason: "feed-unavailable" };
  }
  if (target.status === "open") return { ok: true, action: "start" };

  // Extending one lane is safe only when the complete venue view proves no
  // unreadable board shares the selected session.
  if (lanes.some((lane) => lane.status === "unknown")) {
    return { ok: false, reason: "feed-unavailable" };
  }

  const sessionId = normalizedSessionId(target);
  const currentEndMs = target.sessionEnd
    ? new Date(target.sessionEnd).getTime()
    : Number.NaN;
  const rawMaxPlayers = target.maxPlayers;
  if (
    !sessionId ||
    !Number.isFinite(currentEndMs) ||
    currentEndMs <= nowMs ||
    typeof rawMaxPlayers !== "number" ||
    !Number.isInteger(rawMaxPlayers) ||
    rawMaxPlayers < 1
  ) {
    return { ok: false, reason: "session-unavailable" };
  }

  // If any occupied board lacks a session ID, the venue-wide view cannot
  // prove that the selected session is isolated to one physical lane.
  if (
    lanes.some(
      (lane) => lane.status === "occupied" && !normalizedSessionId(lane),
    )
  ) {
    return { ok: false, reason: "session-unavailable" };
  }

  const matchingBoards = lanes.filter(
    (lane) => normalizedSessionId(lane) === sessionId,
  );
  if (matchingBoards.length !== 1) {
    return { ok: false, reason: "shared-session" };
  }

  return {
    ok: true,
    action: "extend",
    sessionId,
    currentEndMs,
    maxPlayers: rawMaxPlayers,
  };
}
