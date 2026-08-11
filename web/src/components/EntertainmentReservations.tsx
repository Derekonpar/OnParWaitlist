"use client";

import { useEffect, useState } from "react";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import type { Activity } from "@/lib/types";

function categoryMatches(activity: Activity, category: string) {
  const normalized = category.toLowerCase();
  return activity === "darts"
    ? normalized === "darts" || normalized === "dart"
    : normalized === activity;
}

function time(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function venueDate(nowMs: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function EntertainmentReservations({
  activity,
  reservations,
}: {
  activity: Activity;
  reservations: EntertainmentReservation[];
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = venueDate(nowMs);
  const relevant = reservations.filter(
    (reservation) =>
      reservation.operatingDate === today &&
      new Date(reservation.endAt).getTime() > nowMs &&
      categoryMatches(activity, reservation.resourceCategory),
  );
  if (!relevant.length) return null;
  return (
    <details className="mb-5 rounded-xl border border-violet-400/30 bg-violet-500/10">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-violet-100 marker:hidden">
        <span className="flex items-center justify-between gap-3">
          <span>Entertainment schedule</span>
          <span className="rounded-full bg-violet-950 px-2 py-0.5 text-xs text-violet-100">
            {relevant.length} reservation{relevant.length === 1 ? "" : "s"} · expand
          </span>
        </span>
      </summary>
      <div className="space-y-2 border-t border-violet-300/20 px-4 py-3">
        {relevant.map((reservation) => (
          <div key={reservation.id} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{reservation.resourceName}</p>
              <p className="text-xs font-medium text-violet-100">
                {time(reservation.startAt)}–{time(reservation.endAt)}
              </p>
            </div>
            <p className="mt-1 text-xs text-neutral-300">{reservation.eventName}</p>
            {reservation.needsReview && (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                Needs review
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
