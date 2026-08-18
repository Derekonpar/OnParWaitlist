"use client";

import { useState } from "react";
import {
  TIMED_RESOURCES,
  type TimedResourceSession,
  type TimedResourceType,
} from "@/lib/resource-sessions";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import {
  reservationBlocksAvailability,
  reservationConflictsWithSession,
  reservationProtectionActive,
  timedResourceReservationIds,
} from "@/lib/reservation-policy";

const WALK_TO_RESOURCE_BUFFER_MS = 3 * 60_000;
type TimedResourceDuration = 30 | 60 | 120;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function remainingLabel(endsAt: string, nowMs: number) {
  const seconds = Math.ceil((new Date(endsAt).getTime() - nowMs) / 1000);
  if (seconds <= 0) return "Time ended — collect equipment";
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min remaining`;
}

export function TimedResourcePlanner({
  resourceType,
  sessions,
  reservations,
  nowMs,
  busyKey,
  onAdd,
  onClear,
}: {
  resourceType: TimedResourceType;
  sessions: TimedResourceSession[];
  reservations: EntertainmentReservation[];
  nowMs: number;
  busyKey: string | null;
  onAdd: (input: {
    resourceType: TimedResourceType;
    resourceId: string;
    guestName: string;
    startsAt: string;
    durationMinutes: TimedResourceDuration;
  }) => Promise<boolean>;
  onClear: (resourceType: TimedResourceType, resourceId: string) => Promise<void>;
}) {
  const resources = TIMED_RESOURCES[resourceType];
  const [resourceDurations, setResourceDurations] = useState<
    Record<string, TimedResourceDuration>
  >(() => Object.fromEntries(resources.map((resource) => [resource.id, 60])));
  const title = resourceType === "pool" ? "Pool tables" : "Shuffleboards";
  const equipment = resourceType === "pool" ? "balls" : "pucks";

  async function startResourceSession(resourceId: string) {
    await onAdd({
      resourceType,
      resourceId,
      guestName: "Walk-in",
      startsAt: new Date(nowMs + WALK_TO_RESOURCE_BUFFER_MS).toISOString(),
      durationMinutes: resourceDurations[resourceId] ?? 60,
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">{title}</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {resources.map((resource) => {
            const session = sessions.find(
              (item) =>
                item.resourceType === resourceType &&
                item.resourceId === resource.id,
            );
            const warning =
              session && new Date(session.endsAt).getTime() - nowMs <= 5 * 60_000;
            const ids = timedResourceReservationIds(resourceType, resource.id);
            const upcomingReservations = reservations
              .filter(
                (reservation) =>
                  ids.includes(reservation.resourceId.toLowerCase()) &&
                  reservationBlocksAvailability(reservation) &&
                  new Date(reservation.endAt).getTime() > nowMs,
              )
              .sort(
                (a, b) =>
                  new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
              );
            const activeReservation = upcomingReservations.find(
              (reservation) => new Date(reservation.startAt).getTime() <= nowMs,
            );
            const protectedReservation = upcomingReservations.find((reservation) =>
              reservationProtectionActive(reservation, nowMs),
            );
            const nextReservation =
              activeReservation ?? protectedReservation ?? upcomingReservations[0];
            const reservationWarning = Boolean(
              activeReservation || protectedReservation,
            );
            const resourceDuration = resourceDurations[resource.id] ?? 60;
            const resourceStartMs = nowMs + WALK_TO_RESOURCE_BUFFER_MS;
            const resourceEndMs =
              resourceStartMs + resourceDuration * 60_000;
            const resourceConflict = upcomingReservations.find((reservation) =>
              reservationConflictsWithSession(
                reservation,
                resourceStartMs,
                resourceEndMs,
              ),
            );
            const startLabel =
              resourceType === "pool" ? "Start rack" : "Start shuffleboard";
            return (
              <article
                key={resource.id}
                className={`rounded-2xl border p-4 ${
                  warning
                    ? "border-red-500/60 bg-red-950/40"
                    : "border-white/10 bg-[#141414]"
                }`}
              >
                <p className="font-semibold text-white">{resource.label}</p>
                {nextReservation && (
                  <div className={`mt-3 rounded-lg border px-3 py-2 text-white shadow-sm ${
                    reservationWarning
                      ? "border-red-300 bg-red-700"
                      : "border-violet-300/70 bg-violet-950"
                  }`}>
                    <p className="truncate text-xs font-bold text-white">
                      {nextReservation.eventName}
                    </p>
                    <p className={`mt-0.5 text-[11px] font-medium ${reservationWarning ? "text-white" : "text-violet-100"}`}>
                      {activeReservation
                        ? `DO NOT USE · Reserved until ${formatTime(nextReservation.endAt)}`
                        : protectedReservation
                          ? `DO NOT USE · Reserved at ${formatTime(nextReservation.startAt)}`
                        : `Upcoming ${formatTime(nextReservation.startAt)}–${formatTime(nextReservation.endAt)}`}
                    </p>
                    {nextReservation.needsReview && (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                        Needs review
                      </p>
                    )}
                  </div>
                )}
                {!session ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-sm font-medium text-emerald-300">Available</p>
                    <label className="block text-xs font-medium text-neutral-400">
                      Duration
                      <select
                        aria-label={`${resource.label} duration`}
                        value={resourceDuration}
                        onChange={(event) =>
                          setResourceDurations((current) => ({
                            ...current,
                            [resource.id]: Number(event.target.value) as
                              TimedResourceDuration,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                      >
                        <option value={30}>30 minutes</option>
                        <option value={60}>1 hour</option>
                        <option value={120}>2 hours</option>
                      </select>
                    </label>
                    {resourceConflict && (
                      <p
                        className="rounded-lg border border-red-400 bg-red-700 px-3 py-2 text-xs font-semibold text-white"
                        role="alert"
                      >
                        Reserved at {formatTime(resourceConflict.startAt)} — this time would overlap.
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={busyKey !== null || Boolean(resourceConflict)}
                      onClick={() => void startResourceSession(resource.id)}
                      className="w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-60"
                    >
                      {startLabel}
                    </button>
                  </div>
                ) : (
                  <>
                    {session.guestName.trim().toLowerCase() !== "walk-in" && (
                      <p className="mt-3 text-sm text-white">
                        {session.guestName}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-neutral-400">
                      {formatTime(session.startsAt)}–{formatTime(session.endsAt)}
                    </p>
                    <p className={`mt-3 text-sm font-semibold ${warning ? "text-red-300" : "text-neutral-200"}`}>
                      {remainingLabel(session.endsAt, nowMs)}
                    </p>
                    <button
                      type="button"
                      disabled={busyKey === `${resourceType}:${resource.id}`}
                      onClick={() => void onClear(resourceType, resource.id)}
                      className="mt-4 w-full rounded-xl border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-60"
                    >
                      {new Date(session.endsAt).getTime() <= nowMs
                        ? `${equipment[0].toUpperCase()}${equipment.slice(1)} collected — clear`
                        : "End early and clear"}
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
