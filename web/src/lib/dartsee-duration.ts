export const DARTSEE_START_DURATIONS = [30, 60, 120] as const;
export type DartseeStartDuration = (typeof DARTSEE_START_DURATIONS)[number];

export const DARTSEE_START_BUFFER_MINUTES = 1;

/** Convert a staff-facing session choice to the duration sent to Dartsee. */
export function dartseeCommandDurationMinutes(
  durationMinutes: DartseeStartDuration,
): number {
  return durationMinutes + DARTSEE_START_BUFFER_MINUTES;
}
