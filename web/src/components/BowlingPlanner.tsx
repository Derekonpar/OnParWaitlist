"use client";

import { useEffect, useMemo, useState } from "react";
import type { BowlingLaneSnapshot } from "@/lib/bowling-lanes";
import {
  formatClock,
  formatDuration,
  planBowlingAssignments,
} from "@/lib/bowling-planner";
import { formatBookingSummary } from "@/lib/booking";
import type { WaitlistEntry } from "@/lib/types";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";

interface BowlingPlannerProps {
  snapshot: BowlingLaneSnapshot | null;
  entries: WaitlistEntry[];
  reservations?: EntertainmentReservation[];
}

function freshnessLabel(snapshot: BowlingLaneSnapshot | null, nowMs: number) {
  if (!snapshot || nowMs === 0) return "No feed";
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) return "No feed";
  const ageSeconds = Math.max(0, Math.floor((nowMs - capturedAt) / 1000));
  if (ageSeconds < 20) return "Live";
  if (ageSeconds < 120) return `${ageSeconds}s old`;
  return `${Math.floor(ageSeconds / 60)}m old`;
}

function laneClass(status: string) {
  if (status === "open") {
    return "border-emerald-400/50 bg-emerald-500/15 text-emerald-50";
  }
  if (status === "occupied") {
    return "border-white/15 bg-slate-200 text-slate-950";
  }
  if (status === "reserved") {
    return "border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-50";
  }
  return "border-dashed border-white/15 bg-neutral-900 text-neutral-400";
}

export function BowlingPlanner({ snapshot, entries, reservations = [] }: BowlingPlannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const plan = useMemo(
    () => planBowlingAssignments(snapshot, entries, nowMs || undefined, reservations),
    [entries, nowMs, reservations, snapshot],
  );

  const assignmentsByLane = new Map(
    plan.assignments.flatMap((assignment) =>
      assignment.laneNumbers.map((lane) => [lane, assignment] as const),
    ),
  );

  const activeQueueCount = entries.filter(
    (entry) =>
      entry.activity === "bowling" &&
      (entry.status === "waiting" || entry.status === "notified"),
  ).length;

  return (
    <section className="space-y-5">
      {snapshot && snapshot.healthStatus !== "ok" && (
        <div className="rounded-xl border border-red-400/70 bg-red-950/60 p-4">
          <p className="text-sm font-semibold text-red-100">
            Brunswick feed recovery needed
          </p>
          <p className="mt-1 text-sm text-red-200">
            {snapshot.healthMessage ?? "Lane times may be stale."}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Bowling lanes
          </h2>
          <p className="text-xs text-neutral-500">
            Brunswick feed · {freshnessLabel(snapshot, nowMs)} ·{" "}
            {activeQueueCount} waiting
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            Next start
          </p>
          <p className="text-sm font-semibold text-white">
            {plan.assignments[0]
              ? formatDuration(plan.assignments[0].startInSeconds)
              : "No queue"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {plan.lanes.map((lane) => {
          const assignment = assignmentsByLane.get(lane.lane);
          return (
            <div
              key={lane.lane}
              className={`min-h-28 rounded-lg border p-3 shadow-sm ${laneClass(
                lane.status,
              )}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold">Lane {lane.lane}</p>
                <p className="text-sm font-bold">
                  {lane.status === "occupied"
                    ? formatClock(lane.remainingSeconds)
                    : lane.status === "reserved"
                      ? "Reserved"
                    : lane.status === "open"
                      ? "Open"
                      : "--"}
                </p>
              </div>
              {lane.status === "reserved" && lane.reservationLabel && (
                <p className="mt-1 truncate text-[10px] opacity-70">
                  {lane.reservationLabel}
                </p>
              )}
              <div className="mt-5">
                {assignment ? (
                  <div className="rounded-md bg-black/70 px-2 py-1.5 text-white">
                    <p className="truncate text-xs font-semibold">
                      #{assignment.order} {assignment.name}
                    </p>
                    <p className="text-[10px] text-white/70">
                      {assignment.startInSeconds === 0
                        ? "Place now"
                        : `In ${formatDuration(assignment.startInSeconds)}`}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs opacity-60">No pending party</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Placement order</h3>
        {plan.assignments.length === 0 ? (
          <p className="text-sm text-neutral-500">No bowling parties waiting</p>
        ) : (
          <ul className="space-y-2">
            {plan.assignments.map((assignment) => (
              <li
                key={assignment.entryId}
                className="rounded-xl border border-white/10 bg-[#141414] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">
                      #{assignment.order} {assignment.name}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {formatBookingSummary(
                        "bowling",
                        assignment.laneCount,
                        assignment.sessionMinutes,
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      Lanes {assignment.laneNumbers.join(", ")}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {assignment.startInSeconds === 0
                        ? "Now"
                        : `In ${formatDuration(assignment.startInSeconds)}`}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.unassigned.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-100">
            Not enough readable lanes for {plan.unassigned.length} party
            {plan.unassigned.length === 1 ? "" : "ies"}
          </p>
        </div>
      )}
    </section>
  );
}
