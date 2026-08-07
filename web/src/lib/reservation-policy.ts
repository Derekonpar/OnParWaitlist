import type { EntertainmentReservation } from "./entertainment-schedule";

export const RESERVATION_PROTECTION_MS = 60 * 60 * 1000;

export function reservationBlocksAvailability(
  reservation: EntertainmentReservation,
): boolean {
  // Tentative manual Event Host rows remain informational until reviewed.
  // Confirmed Tripleseat rows and reviewed manual overrides protect capacity.
  return (
    reservation.source.trim().toLowerCase() !== "manual" ||
    !reservation.needsReview
  );
}

export function reservationProtectionActive(
  reservation: EntertainmentReservation,
  nowMs: number,
): boolean {
  if (!reservationBlocksAvailability(reservation)) return false;
  const startMs = new Date(reservation.startAt).getTime();
  return (
    Number.isFinite(startMs) &&
    nowMs >= startMs - RESERVATION_PROTECTION_MS &&
    nowMs < startMs
  );
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
  if (!Number.isFinite(reservationStartMs) || !Number.isFinite(reservationEndMs)) {
    return false;
  }
  return (
    sessionStartMs < reservationEndMs &&
    sessionEndMs > reservationStartMs - RESERVATION_PROTECTION_MS
  );
}
