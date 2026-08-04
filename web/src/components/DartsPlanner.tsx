"use client";

import { useEffect, useMemo, useState } from "react";
import type { DartseeLaneSnapshot } from "@/lib/dartsee-lanes";
import { planDartseeAssignments } from "@/lib/dartsee-planner";
import { formatBookingSummary } from "@/lib/booking";
import { formatClock, formatDuration } from "@/lib/bowling-planner";
import type { WaitlistEntry } from "@/lib/types";

interface DartsPlannerProps {
  snapshot: DartseeLaneSnapshot | null;
  entries: WaitlistEntry[];
}

function freshnessLabel(snapshot: DartseeLaneSnapshot | null, nowMs: number) {
  if (!snapshot || nowMs === 0) return "No feed";
  if (snapshot.healthStatus !== "ok") return "Needs attention";
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
    return "border-white/15 bg-zinc-200 text-zinc-950";
  }
  return "border-dashed border-white/15 bg-neutral-900 text-neutral-400";
}

export function DartsPlanner({ snapshot, entries }: DartsPlannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const plan = useMemo(
    () => planDartseeAssignments(snapshot, entries, nowMs || undefined),
    [entries, nowMs, snapshot],
  );

  const assignmentsByBoard = new Map(
    plan.assignments.flatMap((assignment) =>
      assignment.boardIds.map((boardId) => [boardId, assignment] as const),
    ),
  );

  const activeQueueCount = entries.filter(
    (entry) =>
      entry.activity === "darts" &&
      (entry.status === "waiting" || entry.status === "notified"),
  ).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Dart lanes</h2>
          <p className="text-xs text-neutral-500">
            Dartsee feed · {freshnessLabel(snapshot, nowMs)} ·{" "}
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

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {plan.lanes.map((lane) => {
          const assignment = assignmentsByBoard.get(lane.boardId);
          return (
            <div
              key={lane.boardId}
              className={`min-h-28 rounded-lg border p-3 shadow-sm ${laneClass(
                lane.status,
              )}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold">Dart {lane.lane}</p>
                <p className="text-sm font-bold">
                  {lane.status === "occupied"
                    ? formatClock(lane.remainingSeconds)
                    : lane.status === "open"
                      ? "Open"
                      : "--"}
                </p>
              </div>
              <p className="mt-1 truncate text-[10px] opacity-60">
                {lane.boardId}
              </p>
              <div className="mt-4">
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

      {snapshot && snapshot.healthStatus !== "ok" && (
        <div className="rounded-xl border border-red-400 bg-red-700 p-4 text-white" role="alert">
          <p className="text-sm font-semibold">Dartsee feed needs attention</p>
          <p className="mt-1 text-xs text-red-100">
            {snapshot.healthMessage ?? "One or more dart lanes could not be read."}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Placement order</h3>
        {plan.assignments.length === 0 ? (
          <p className="text-sm text-neutral-500">No dart parties waiting</p>
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
                        "darts",
                        assignment.laneCount,
                        assignment.sessionMinutes,
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      Darts {assignment.laneNumbers.join(", ")}
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
            Not enough readable dart lanes for {plan.unassigned.length} party
            {plan.unassigned.length === 1 ? "" : "ies"}
          </p>
        </div>
      )}
    </section>
  );
}
