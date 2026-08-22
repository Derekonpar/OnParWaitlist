export const BOWLING_CLEANING_BUFFER_MINUTES = 5;
export const BOWLING_CLEANING_BUFFER_SECONDS =
  BOWLING_CLEANING_BUFFER_MINUTES * 60;

export function bowlingLaneAvailableAtSeconds(
  status: "open" | "occupied" | "reserved" | "unknown",
  remainingSeconds: number,
  elapsedSeconds = 0,
): number {
  if (status === "open") return 0;
  if (status !== "occupied") return Number.POSITIVE_INFINITY;
  return (
    Math.max(0, remainingSeconds - elapsedSeconds) +
    BOWLING_CLEANING_BUFFER_SECONDS
  );
}
