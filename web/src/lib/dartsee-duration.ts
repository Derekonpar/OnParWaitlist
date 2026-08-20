export const DARTSEE_START_DURATIONS = [30, 60, 120] as const;
export type DartseeStartDuration = (typeof DARTSEE_START_DURATIONS)[number];

export const DARTSEE_START_BUFFER_MINUTES = 1;
export const DARTSEE_OVERRIDE_MIN_MINUTES = 1;
export const DARTSEE_OVERRIDE_MAX_MINUTES = 480;

export function isDartseeOverrideDuration(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DARTSEE_OVERRIDE_MIN_MINUTES &&
    value <= DARTSEE_OVERRIDE_MAX_MINUTES
  );
}

/** Convert a staff-facing session choice to the duration sent to Dartsee. */
export function dartseeCommandDurationMinutes(
  durationMinutes: number,
): number {
  return durationMinutes + DARTSEE_START_BUFFER_MINUTES;
}
