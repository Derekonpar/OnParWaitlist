export const DARTSEE_SAFETY_STALE_AFTER_MS = 60_000;
export const DARTSEE_EMPLOYEE_ALERT_AFTER_MS = 5 * 60_000;
export const DARTSEE_SUSTAINED_FAILURE_REFRESHES = 20;

type DartseePresentationHealth =
  | "ok"
  | "partial"
  | "no-data"
  | "connection-error"
  | "auth-error"
  | null;

export type DartseeLaneFeedTone = "normal" | "refreshing" | "attention";

export interface DartseeLaneFeedPresentationInput {
  hasSnapshot: boolean;
  snapshotAgeMs: number;
  healthStatus: DartseePresentationHealth;
  consecutiveIncompleteRefreshes: number;
  laneUnresponsive: boolean;
}

export interface DartseeLaneFeedPresentation {
  safetyUnavailable: boolean;
  tone: DartseeLaneFeedTone;
}

/**
 * Keep automatic placement and controls stricter than employee-facing alarms.
 * A briefly delayed or incomplete feed pauses writes immediately, but does not
 * tell staff that a machine is offline until the failure is actionable.
 */
export function dartseeLaneFeedPresentation({
  hasSnapshot,
  snapshotAgeMs,
  healthStatus,
  consecutiveIncompleteRefreshes,
  laneUnresponsive,
}: DartseeLaneFeedPresentationInput): DartseeLaneFeedPresentation {
  const feedSafetyUnavailable =
    !hasSnapshot ||
    !Number.isFinite(snapshotAgeMs) ||
    snapshotAgeMs > DARTSEE_SAFETY_STALE_AFTER_MS ||
    (healthStatus !== "ok" && healthStatus !== "partial");
  const safetyUnavailable = feedSafetyUnavailable || laneUnresponsive;

  if (!safetyUnavailable) {
    return { safetyUnavailable: false, tone: "normal" };
  }

  const actionable =
    !hasSnapshot ||
    healthStatus === "auth-error" ||
    snapshotAgeMs > DARTSEE_EMPLOYEE_ALERT_AFTER_MS ||
    consecutiveIncompleteRefreshes >= DARTSEE_SUSTAINED_FAILURE_REFRESHES;

  return {
    safetyUnavailable: true,
    tone: actionable ? "attention" : "refreshing",
  };
}
