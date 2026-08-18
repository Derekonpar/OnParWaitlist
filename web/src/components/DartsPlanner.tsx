"use client";

import { useEffect, useMemo, useState } from "react";
import type { DartseeLaneSnapshot } from "@/lib/dartsee-lanes";
import { planDartseeAssignments } from "@/lib/dartsee-planner";
import { formatBookingSummary } from "@/lib/booking";
import { formatClock, formatDuration } from "@/lib/bowling-planner";
import type { WaitlistEntry } from "@/lib/types";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import { dartseeCommandDurationMinutes } from "@/lib/dartsee-duration";
import { dartseeLaneFeedPresentation } from "@/lib/dartsee-feed-presentation";
import {
  reservationBlocksAvailability,
  reservationConflictsWithSession,
  reservationProtectionActive,
} from "@/lib/reservation-policy";

type DartStartDuration = 30 | 60 | 120;

interface DartsPlannerProps {
  snapshot: DartseeLaneSnapshot | null;
  entries: WaitlistEntry[];
  reservations?: EntertainmentReservation[];
  controllingLane: number | null;
  pendingControls: Array<{
    action: "start" | "end";
    lane: number;
    timedOut?: boolean;
  }>;
  reservationProtectionReady: boolean;
  onStartLane: (
    lane: number,
    durationMinutes: DartStartDuration,
  ) => Promise<boolean>;
  onEndLane: (lane: number) => Promise<boolean>;
}

const DARTSEE_STALE_AFTER_MS = 60_000;

function freshnessLabel(snapshot: DartseeLaneSnapshot | null, nowMs: number) {
  if (!snapshot || nowMs === 0) return "No feed";
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) return "No feed";
  const ageSeconds = Math.max(0, Math.floor((nowMs - capturedAt) / 1000));
  if (
    snapshot.healthStatus !== "ok" ||
    (snapshot.unresponsiveBoardIds?.length ?? 0) > 0 ||
    nowMs - capturedAt > DARTSEE_STALE_AFTER_MS
  ) {
    return `Refreshing · ${ageSeconds}s old`;
  }
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
  if (status === "reserved") {
    return "border-amber-400/40 bg-neutral-900 text-white";
  }
  return "border-dashed border-white/15 bg-neutral-900 text-neutral-400";
}

function reservationTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DartsPlanner({
  snapshot,
  entries,
  reservations = [],
  controllingLane,
  pendingControls,
  reservationProtectionReady,
  onStartLane,
  onEndLane,
}: DartsPlannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [startDurations, setStartDurations] = useState<
    Record<number, DartStartDuration>
  >({});
  const capturedAtMs = snapshot
    ? new Date(snapshot.capturedAt).getTime()
    : Number.NaN;
  const snapshotAgeMs = Number.isFinite(capturedAtMs)
    ? Math.max(0, nowMs - capturedAtMs)
    : Number.POSITIVE_INFINITY;

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const plan = useMemo(
    () => planDartseeAssignments(snapshot, entries, nowMs || undefined, reservations),
    [entries, nowMs, reservations, snapshot],
  );

  const assignmentsByBoard = new Map(
    plan.assignments.flatMap((assignment) =>
      assignment.boardIds.map((boardId) => [boardId, assignment] as const),
    ),
  );
  const unresponsiveBoards = new Set(snapshot?.unresponsiveBoardIds ?? []);
  const unresponsiveLaneNumbers = snapshot?.lanes
    .filter((lane) => unresponsiveBoards.has(lane.boardId))
    .map((lane) => lane.lane) ?? [];
  const feedPresentationForBoard = (boardId: string) =>
    dartseeLaneFeedPresentation({
      hasSnapshot: Boolean(snapshot),
      snapshotAgeMs,
      healthStatus: snapshot?.healthStatus ?? null,
      consecutiveIncompleteRefreshes:
        snapshot?.consecutiveIncompleteRefreshes ?? 0,
      laneUnresponsive: unresponsiveBoards.has(boardId),
    });
  const hasRefreshingLane = plan.lanes.some(
    (lane) => feedPresentationForBoard(lane.boardId).tone === "refreshing",
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {plan.lanes.map((lane) => {
          const feedPresentation = feedPresentationForBoard(lane.boardId);
          const machineOffline = feedPresentation.tone === "attention";
          const feedRefreshing = feedPresentation.tone === "refreshing";
          const laneUnresponsive = unresponsiveBoards.has(lane.boardId);
          const assignment = assignmentsByBoard.get(lane.boardId);
          const ids = [`darts-${lane.lane}`, `dart-${lane.lane}`];
          const laneReservations = reservations
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
          const activeReservation = laneReservations.find(
            (reservation) => new Date(reservation.startAt).getTime() <= nowMs,
          );
          const protectedReservation = laneReservations.find((reservation) =>
            reservationProtectionActive(reservation, nowMs),
          );
          const nextReservation =
            activeReservation ?? protectedReservation ?? laneReservations[0];
          const reservationWarning = Boolean(
            activeReservation || protectedReservation,
          );
          const startDuration = startDurations[lane.lane] ?? 60;
          const selectedEndMs =
            nowMs + dartseeCommandDurationMinutes(startDuration) * 60_000;
          const selectedConflict = laneReservations.find((reservation) =>
            reservationConflictsWithSession(
              reservation,
              nowMs,
              selectedEndMs,
            ),
          );
          const controlInProgress = controllingLane === lane.lane;
          const pendingControl = pendingControls.find(
            (pending) => pending.lane === lane.lane,
          );
          const pendingThisLane = Boolean(pendingControl);
          const anotherControlInProgress =
            controllingLane !== null && !controlInProgress;
          const optimisticStart =
            (controlInProgress && lane.status === "open") ||
            (pendingControl?.action === "start" && lane.status !== "occupied");
          const optimisticRemainingSeconds =
            dartseeCommandDurationMinutes(startDuration) * 60;
          const displayedStatus = optimisticStart ? "occupied" : lane.status;
          const displayedRemainingSeconds = optimisticStart
            ? optimisticRemainingSeconds
            : lane.remainingSeconds;
          const endingInProgress =
            controlInProgress && lane.status === "occupied";
          const endAwaitingConfirmation = pendingControl?.action === "end";
          const startDisabled =
            controllingLane !== null ||
            pendingThisLane ||
            feedPresentation.safetyUnavailable ||
            lane.status !== "open" ||
            !reservationProtectionReady ||
            Boolean(selectedConflict);
          const startLabel = pendingThisLane
            ? pendingControl?.timedOut
              ? "Check unit"
              : "Verifying…"
            : controlInProgress
            ? "Starting…"
            : anotherControlInProgress
              ? "Please wait"
              : machineOffline
                ? "Check unit"
                : feedRefreshing
                  ? "Refreshing"
                  : lane.status === "occupied"
                    ? "In use"
                    : lane.status !== "open"
                      ? "Unavailable"
                      : !reservationProtectionReady
                        ? "Schedule updating"
                        : selectedConflict
                          ? "Reserved soon"
                          : "Start";
          return (
            <div
              key={lane.boardId}
              className={`flex min-h-28 flex-col rounded-lg border p-3 shadow-sm ${
                machineOffline
                  ? "border-red-400 bg-red-950/60 text-red-50"
                  : feedRefreshing
                    ? "border-amber-400/50 bg-amber-950/50 text-amber-50"
                    : laneClass(displayedStatus)
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold">Dart {lane.lane}</p>
                <p className="text-sm font-bold">
                  {machineOffline
                    ? "Check unit"
                    : feedRefreshing
                      ? "Refreshing"
                      : endingInProgress
                        ? "Ending…"
                        : endAwaitingConfirmation
                          ? pendingControl?.timedOut
                            ? "Check unit"
                            : "Verifying…"
                          : displayedStatus === "occupied"
                            ? formatClock(displayedRemainingSeconds)
                            : displayedStatus === "open"
                              ? "Open"
                              : "--"}
                </p>
              </div>
              <p className="mt-1 truncate text-[10px] opacity-60">
                {lane.boardId}
              </p>
              {machineOffline && (
                <div className="mt-2 rounded-md border border-red-300/60 bg-red-700 px-2 py-1.5 text-white">
                  <p className="text-[10px] font-bold uppercase tracking-wide">
                    {laneUnresponsive ? "Machine offline" : "Feed needs attention"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-red-100">
                    {laneUnresponsive
                      ? "Staff: go check this Dartsee unit"
                      : "Staff: check Dartsee Central and this lane unit"}
                  </p>
                </div>
              )}
              {feedRefreshing && (
                <div className="mt-2 rounded-md border border-amber-300/50 bg-amber-700/35 px-2 py-1.5 text-amber-50">
                  <p className="text-[10px] font-bold uppercase tracking-wide">
                    Status refreshing
                  </p>
                  <p className="mt-0.5 text-[10px] text-amber-100/90">
                    Lane controls stay paused until a fresh reading arrives
                  </p>
                </div>
              )}
              {nextReservation && (
                <div className={`mt-2 rounded-md border px-2 py-1.5 text-white shadow-sm ${
                  reservationWarning
                    ? "border-red-300 bg-red-700"
                    : "border-violet-300/70 bg-violet-950"
                }`}>
                  <p className="truncate text-[10px] font-bold text-white">
                    {nextReservation.eventName}
                  </p>
                  <p className={`text-[9px] font-medium ${reservationWarning ? "text-white" : "text-violet-100"}`}>
                    {activeReservation
                      ? `DO NOT USE · Reserved until ${reservationTime(nextReservation.endAt)}`
                      : protectedReservation
                        ? `DO NOT USE · Reserved at ${reservationTime(nextReservation.startAt)}`
                      : `Upcoming ${reservationTime(nextReservation.startAt)}`}
                  </p>
                </div>
              )}
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
              <div className="mt-auto pt-3">
                <div className="rounded-lg bg-black/70 p-2 text-white">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-white/65">
                    {optimisticStart
                      ? "Starting session"
                      : lane.status === "occupied"
                        ? "Active session"
                        : "Session time"}
                    {displayedStatus === "occupied" ? (
                      <span className="mt-1 block rounded-md border border-white/15 bg-neutral-900 px-2 py-2 text-xs font-medium text-white">
                        {formatClock(displayedRemainingSeconds)} remaining
                      </span>
                    ) : (
                      <select
                        aria-label={`Dart ${lane.lane} session time`}
                        value={startDuration}
                        disabled={
                          controllingLane !== null ||
                          pendingThisLane ||
                          feedPresentation.safetyUnavailable ||
                          lane.status !== "open" ||
                          !reservationProtectionReady
                        }
                        onChange={(event) =>
                          setStartDurations((current) => ({
                            ...current,
                            [lane.lane]: Number(
                              event.target.value,
                            ) as DartStartDuration,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-white/20 bg-neutral-900 px-2 py-2 text-xs font-medium text-white disabled:opacity-55"
                      >
                        <option value={30}>30 minutes</option>
                        <option value={60}>1 hour</option>
                        <option value={120}>2 hours</option>
                      </select>
                    )}
                  </label>
                  {optimisticStart ? (
                    <button
                      type="button"
                      disabled
                      aria-label={`Starting Dart ${lane.lane}`}
                      className="mt-2 w-full rounded-md bg-neutral-600 px-2 py-2 text-xs font-bold text-neutral-200"
                    >
                      {pendingControl?.timedOut
                        ? "Check unit"
                        : pendingThisLane
                          ? "Verifying…"
                          : "Starting…"}
                    </button>
                  ) : lane.status === "occupied" ? (
                    <button
                      type="button"
                      aria-label={`End Dart ${lane.lane} session`}
                      disabled={
                        controllingLane !== null ||
                        pendingThisLane ||
                        feedPresentation.safetyUnavailable
                      }
                      onClick={() => void onEndLane(lane.lane)}
                      className="mt-2 w-full rounded-md bg-red-600 px-2 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:bg-neutral-600 disabled:text-neutral-300"
                    >
                      {pendingThisLane
                        ? pendingControl?.timedOut
                          ? "Check unit"
                          : "Verifying…"
                        : controlInProgress
                          ? "Ending…"
                          : anotherControlInProgress
                            ? "Please wait"
                            : machineOffline
                              ? "Check unit"
                              : feedRefreshing
                                ? "Refreshing"
                                : "End session"}
                    </button>
                  ) : (
                    <>
                      {selectedConflict && lane.status === "open" && (
                        <p className="mt-1.5 text-[10px] font-semibold text-red-200">
                          Selected time overlaps reservation protection.
                        </p>
                      )}
                      <button
                        type="button"
                        aria-label={`Start Dart ${lane.lane} for ${startDuration} minutes`}
                        disabled={startDisabled}
                        onClick={() =>
                          void onStartLane(lane.lane, startDuration)
                        }
                        className="mt-2 w-full rounded-md bg-white px-2 py-2 text-xs font-bold text-neutral-950 disabled:bg-neutral-600 disabled:text-neutral-300"
                      >
                        {startLabel}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {snapshot && hasRefreshingLane && (
        <div
          className="rounded-xl border border-amber-400/35 bg-amber-500/10 p-3 text-amber-50"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold">Dart status refreshing</p>
          <p className="mt-1 text-xs text-amber-100/85">
            {snapshotAgeMs > DARTSEE_STALE_AFTER_MS
              ? `Last live snapshot was ${freshnessLabel(snapshot, nowMs).replace("Refreshing · ", "")}. Automatic placement and lane controls stay paused until a fresh reading arrives.`
              : unresponsiveLaneNumbers.length
              ? `Dart lane${unresponsiveLaneNumbers.length === 1 ? "" : "s"} ${unresponsiveLaneNumbers.join(", ")} ${unresponsiveLaneNumbers.length === 1 ? "is" : "are"} still syncing and will remain unavailable until ${unresponsiveLaneNumbers.length === 1 ? "it responds" : "they respond"}.`
              : "The latest Dartsee refresh was incomplete. Last-known lane information remains visible, while automatic placement and lane controls stay safely paused."}
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
