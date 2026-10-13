/** Preserve original source coverage and clocks independently of a display projection. */
export function captureScheduleEvidence(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.from !== "string" || typeof input.to !== "string" ||
    input.timeZone !== "America/New_York" || !Array.isArray(input.reservations) ||
    input.reservationCount !== input.reservations.length ||
    !input.evidence || typeof input.evidence !== "object" || input.reservations.length > 10000) return null;
  const rows = input.reservations as Record<string, unknown>[];
  if (rows.some((row) => !row || typeof row.id !== "string") ||
    new Set(rows.map((row) => row.id)).size !== rows.length) return null;
  return {
    from: input.from, to: input.to, timeZone: input.timeZone,
    reservationCount: input.reservationCount,
    // Deliberately retain spanning allocations even when the UI projects only today's rows.
    reservations: rows.map((row) => ({
      id: row.id, operatingDate: row.operatingDate, eventId: row.eventId,
      resourceId: row.resourceId, resourceCategory: row.resourceCategory,
      startAt: row.startAt, endAt: row.endAt, needsReview: row.needsReview,
    })),
    evidence: input.evidence,
  };
}
export type ScheduleSourceSnapshot = NonNullable<ReturnType<typeof captureScheduleEvidence>>;
