export const KARAOKE_DISPLAY_TIME_ZONE = "America/New_York";
export const KARAOKE_OPERATING_DAY_ROLLOVER_HOUR = 6;
export const KARAOKE_WEEKDAY_CLOSE_MINUTES = 22 * 60 + 30;
export const KARAOKE_WEEKEND_CLOSE_MINUTES = 24 * 60 + 30;

export type KaraokeInactiveDisplayStatus = "no-wait" | "not-open";

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: KARAOKE_DISPLAY_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function newYorkClockParts(nowMs: number) {
  if (!Number.isFinite(nowMs)) return null;

  const values = Object.fromEntries(
    NEW_YORK_CLOCK.formatToParts(new Date(nowMs)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  const weekday = WEEKDAY_INDEX[values.weekday];
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (
    !Number.isInteger(weekday) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  return { weekday, hour, minute };
}

/**
 * Presentation policy for a healthy Singa response whose session is null.
 * Before 6am belongs to the prior operating night so Friday and Saturday
 * service can remain open through 12:30am without misclassifying late-night
 * Saturday as already closed.
 */
export function karaokeInactiveDisplayStatus(
  nowMs: number,
): KaraokeInactiveDisplayStatus {
  const clock = newYorkClockParts(nowMs);
  if (!clock) return "not-open";

  const belongsToPriorOperatingNight =
    clock.hour < KARAOKE_OPERATING_DAY_ROLLOVER_HOUR;
  const operatingWeekday = belongsToPriorOperatingNight
    ? (clock.weekday + 6) % 7
    : clock.weekday;
  const operatingMinutes =
    clock.hour * 60 +
    clock.minute +
    (belongsToPriorOperatingNight ? 24 * 60 : 0);
  const closeMinutes =
    operatingWeekday === 5 || operatingWeekday === 6
      ? KARAOKE_WEEKEND_CLOSE_MINUTES
      : KARAOKE_WEEKDAY_CLOSE_MINUTES;

  return operatingMinutes >= closeMinutes ? "not-open" : "no-wait";
}
