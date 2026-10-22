import type { EntertainmentReservation } from "./entertainment-schedule";

export function reservationBlocksAvailability(
  _reservation: EntertainmentReservation,
): boolean {
  // The producer returns only saved, normalized entertainment assignments for
  // definite events. Manual resource rows complete assignments that may not be
  // present in structured Tripleseat selections, so they protect capacity too.
  // needsReview remains a visible staff warning; it does not discard the lane.
  return true;
}

export function timedResourceReservationIds(
  resourceType: "pool" | "shuffleboard",
  resourceId: string,
): string[] {
  if (resourceType === "shuffleboard") return [`shuffleboard-${resourceId}`];
  const number = ({ red: "1", green: "2", blue: "3" } as Record<string, string>)[resourceId] ?? resourceId;
  return [`pool-${number}`, `pool-${resourceId}`];
}

export function reservationConflictsWithSession(
  reservation: EntertainmentReservation,
  sessionStartMs: number,
  sessionEndMs: number,
): boolean {
  if (!reservationBlocksAvailability(reservation)) return false;
  const reservationStartMs = new Date(reservation.startAt).getTime();
  const reservationEndMs = new Date(reservation.endAt).getTime();
  if (!Number.isFinite(reservationStartMs) || !Number.isFinite(reservationEndMs) || reservationEndMs <= reservationStartMs) {
    // A known reservation with unverified timing cannot prove this resource free.
    return true;
  }
  return (
    sessionStartMs < reservationEndMs &&
    sessionEndMs > reservationStartMs
  );
}
