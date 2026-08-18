export interface DartseeSessionSafetyLane {
  boardId: string;
  status: "open" | "occupied" | "unknown";
  sessionId?: string;
}

export type DartseeEndSessionInspection =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      reason:
        | "target-missing"
        | "lane-open"
        | "session-unavailable"
        | "shared-session";
    };

function normalizedSessionId(lane: DartseeSessionSafetyLane): string | null {
  const value = lane.sessionId?.trim();
  return value ? value : null;
}

/**
 * End is safe only when every occupied board identifies its session and the
 * target session appears on exactly one board in the complete venue snapshot.
 */
export function inspectDartseeEndSession(
  lanes: DartseeSessionSafetyLane[],
  boardId: string,
): DartseeEndSessionInspection {
  const target = lanes.find((lane) => lane.boardId === boardId);
  if (!target) return { ok: false, reason: "target-missing" };
  if (target.status === "open") return { ok: false, reason: "lane-open" };

  const targetSessionId = normalizedSessionId(target);
  if (target.status !== "occupied" || !targetSessionId) {
    return { ok: false, reason: "session-unavailable" };
  }

  if (
    lanes.some(
      (lane) => lane.status === "occupied" && !normalizedSessionId(lane),
    )
  ) {
    return { ok: false, reason: "session-unavailable" };
  }

  const sessionBoardCount = lanes.filter(
    (lane) => normalizedSessionId(lane) === targetSessionId,
  ).length;
  if (sessionBoardCount !== 1) {
    return { ok: false, reason: "shared-session" };
  }
  return { ok: true, sessionId: targetSessionId };
}
