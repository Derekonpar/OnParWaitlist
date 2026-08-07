"use client";

import { useMemo, useState } from "react";
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

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

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
    durationMinutes: 60 | 120;
  }) => Promise<boolean>;
  onClear: (resourceType: TimedResourceType, resourceId: string) => Promise<void>;
}) {
  const resources = TIMED_RESOURCES[resourceType];
  const [resourceId, setResourceId] = useState(resources[0].id);
  const [guestName, setGuestName] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    localDateTimeValue(new Date(Date.now() + WALK_TO_RESOURCE_BUFFER_MS)),
  );
  const [durationMinutes, setDurationMinutes] = useState<60 | 120>(60);
  const title = resourceType === "pool" ? "Pool tables" : "Shuffleboards";
  const equipment = resourceType === "pool" ? "balls" : "pucks";
  const selectedEnd = useMemo(() => {
    const start = new Date(startsAt);
    if (!Number.isFinite(start.getTime())) return "—";
    return formatTime(
      new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
    );
  }, [startsAt, durationMinutes]);
  const selectedConflict = useMemo(() => {
    const startMs = new Date(startsAt).getTime();
    if (!Number.isFinite(startMs)) return undefined;
    const endMs = startMs + durationMinutes * 60_000;
    const ids = timedResourceReservationIds(resourceType, resourceId);
    return reservations.find(
      (reservation) =>
        ids.includes(reservation.resourceId.toLowerCase()) &&
        reservationConflictsWithSession(reservation, startMs, endMs),
    );
  }, [durationMinutes, reservations, resourceId, resourceType, startsAt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const ok = await onAdd({
      resourceType,
      resourceId,
      guestName,
      startsAt: new Date(startsAt).toISOString(),
      durationMinutes,
    });
    if (ok) {
      setGuestName("");
      setStartsAt(
        localDateTimeValue(new Date(Date.now() + WALK_TO_RESOURCE_BUFFER_MS)),
      );
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-[#141414] p-5">
        <h2 className="text-lg font-semibold text-white">Start {title.toLowerCase()} time</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Start time defaults to 3 minutes from now for the walk back. End time updates from the selected duration.
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-2">
          <select
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.label}
              </option>
            ))}
          </select>
          <input
            required
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Guest name"
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
          />
          <label className="text-xs font-medium text-neutral-400">
            Start time
            <input
              required
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
            />
          </label>
          <div>
            <p className="text-xs font-medium text-neutral-400">Duration</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([60, 120] as const).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setDurationMinutes(minutes)}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                    durationMinutes === minutes
                      ? "border-white bg-white text-neutral-950"
                      : "border-neutral-700 bg-neutral-900 text-neutral-300"
                  }`}
                >
                  {minutes / 60} hour{minutes === 120 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
            Scheduled end: <strong className="text-white">{selectedEnd}</strong>
          </div>
          {selectedConflict && (
            <div className="rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-sm font-semibold text-white" role="alert">
              Cannot book: protect this table starting one hour before {formatTime(selectedConflict.startAt)} for {selectedConflict.eventName}.
            </div>
          )}
          <button
            type="submit"
            disabled={busyKey !== null || Boolean(selectedConflict)}
            className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-60"
          >
            Add session
          </button>
        </form>
      </section>

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
                    protectedReservation
                      ? "border-red-300 bg-red-700"
                      : "border-violet-300/70 bg-violet-950"
                  }`}>
                    <p className="truncate text-xs font-bold text-white">
                      {nextReservation.eventName}
                    </p>
                    <p className={`mt-0.5 text-[11px] font-medium ${protectedReservation ? "text-white" : "text-violet-100"}`}>
                      {activeReservation
                        ? `Reserved until ${formatTime(nextReservation.endAt)}`
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
                  <p className="mt-3 text-sm font-medium text-emerald-300">Available</p>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-white">{session.guestName}</p>
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
