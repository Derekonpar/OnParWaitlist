export interface TvWaitDuration {
  value: string;
  unit: "min" | "hr";
}

/**
 * TV waits stay in whole minutes below an hour. Longer waits round upward to
 * the next tenth of an hour so the public display never understates a wait.
 */
export function formatTvWaitDuration(minutes: number): TvWaitDuration {
  const safeMinutes = Number.isFinite(minutes)
    ? Math.max(0, Math.ceil(minutes))
    : 0;
  if (safeMinutes < 60) {
    return { value: String(safeMinutes), unit: "min" };
  }

  const tenthsOfAnHour = Math.ceil(safeMinutes / 6);
  return { value: (tenthsOfAnHour / 10).toFixed(1), unit: "hr" };
}
