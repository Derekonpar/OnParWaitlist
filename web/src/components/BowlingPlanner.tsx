"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import type {
  BowlingLaneSnapshot,
  BowlingLaneStatus,
} from "@/lib/bowling-lanes";
import {
  formatClock,
  formatDuration,
  planBowlingAssignments,
} from "@/lib/bowling-planner";
import { formatBookingSummary } from "@/lib/booking";
import type { WaitlistEntry } from "@/lib/types";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import {
  reservationBlocksAvailability,
  reservationProtectionActive,
} from "@/lib/reservation-policy";
import styles from "./BowlingPlanner.module.css";

const BowlingLaneScene = dynamic(() => import("./BowlingLaneScene"), {
  ssr: false,
  loading: () => <div className={styles.sceneLoading}>Loading lanes…</div>,
});

interface BowlingPlannerProps {
  snapshot: BowlingLaneSnapshot | null;
  entries: WaitlistEntry[];
  reservations?: EntertainmentReservation[];
}

const BOWLING_STALE_AFTER_MS = 2 * 60_000;

function freshnessLabel(snapshot: BowlingLaneSnapshot | null, nowMs: number) {
  if (!snapshot || nowMs === 0) return "No feed";
  if (snapshot.healthStatus !== "ok") return "Needs attention";
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  if (!Number.isFinite(capturedAt)) return "No feed";
  const ageSeconds = Math.max(0, Math.floor((nowMs - capturedAt) / 1000));
  if (ageSeconds < 20) return "Live";
  if (ageSeconds < 120) return `${ageSeconds}s old`;
  return `${Math.floor(ageSeconds / 60)}m old`;
}

function reservationTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function laneValue(status: BowlingLaneStatus, remainingSeconds: number) {
  if (status === "occupied") return formatClock(remainingSeconds);
  if (status === "reserved") return "Reserved";
  if (status === "open") return "Open";
  return "--";
}

function statusName(status: BowlingLaneStatus) {
  if (status === "occupied") return "In use";
  if (status === "reserved") return "Reserved";
  if (status === "open") return "Open";
  return "Unknown";
}

function eventReservationLabel(
  reservation: EntertainmentReservation,
  active: boolean,
  protectedNow: boolean,
) {
  if (active) {
    return `DO NOT USE · Reserved until ${reservationTime(reservation.endAt)}`;
  }
  if (protectedNow) {
    return `DO NOT USE · Reserved at ${reservationTime(reservation.startAt)}`;
  }
  return `Upcoming ${reservationTime(reservation.startAt)}`;
}

export function BowlingPlanner({ snapshot, entries, reservations = [] }: BowlingPlannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedLaneNumber, setSelectedLaneNumber] = useState(1);
  const [sceneReady, setSceneReady] = useState(false);
  const capturedAtMs = snapshot
    ? new Date(snapshot.capturedAt).getTime()
    : Number.NaN;
  const feedStale =
    !Number.isFinite(capturedAtMs) ||
    nowMs - capturedAtMs > BOWLING_STALE_AFTER_MS;
  const feedUnavailable = !snapshot || snapshot.healthStatus !== "ok" || feedStale;

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const plan = useMemo(
    () => planBowlingAssignments(snapshot, entries, nowMs || undefined, reservations),
    [entries, nowMs, reservations, snapshot],
  );

  const assignmentsByLane = useMemo(
    () =>
      new Map(
        plan.assignments.flatMap((assignment) =>
          assignment.laneNumbers.map((lane) => [lane, assignment] as const),
        ),
      ),
    [plan.assignments],
  );

  const activeQueueCount = entries.filter(
    (entry) =>
      entry.activity === "bowling" &&
      (entry.status === "waiting" || entry.status === "notified"),
  ).length;

  const laneViews = useMemo(
    () =>
      plan.lanes.map((lane) => {
        const laneReservations = reservations
          .filter(
            (reservation) =>
              reservation.resourceId.toLowerCase() === `bowling-${lane.lane}` &&
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
        const displayStatus: BowlingLaneStatus = feedUnavailable
          ? "unknown"
          : lane.status;

        return {
          lane,
          displayStatus,
          value: laneValue(displayStatus, lane.remainingSeconds),
          assignment: assignmentsByLane.get(lane.lane),
          activeReservation,
          protectedReservation,
          nextReservation,
          reservationWarning: Boolean(activeReservation || protectedReservation),
        };
      }),
    [assignmentsByLane, feedUnavailable, nowMs, plan.lanes, reservations],
  );

  const selectedLane =
    laneViews.find((lane) => lane.lane.lane === selectedLaneNumber) ?? laneViews[0];
  const sceneLanes = laneViews.map((view) => ({
    lane: view.lane.lane,
    status: view.displayStatus,
    warning: view.reservationWarning,
  }));
  const openLaneCount = laneViews.filter(
    (lane) => lane.displayStatus === "open" && !lane.reservationWarning,
  ).length;
  const occupiedLaneCount = laneViews.filter(
    (lane) => lane.displayStatus === "occupied" && !lane.reservationWarning,
  ).length;
  const reservedLaneCount = laneViews.filter(
    (lane) => lane.displayStatus === "reserved" || lane.reservationWarning,
  ).length;
  const availabilityDegrees = feedUnavailable
    ? 0
    : Math.round((openLaneCount / Math.max(1, laneViews.length)) * 360);
  const selectedReservationText = selectedLane?.nextReservation
    ? eventReservationLabel(
        selectedLane.nextReservation,
        Boolean(selectedLane.activeReservation),
        Boolean(selectedLane.protectedReservation),
      )
    : null;

  return (
    <section className={styles.console}>
      <div className={styles.consoleGrid} aria-hidden="true" />

      {snapshot && feedUnavailable && (
        <div className={styles.recoveryAlert} role="alert">
          <p className={styles.recoveryTitle}>Brunswick feed recovery needed</p>
          <p className={styles.recoveryCopy}>
            {snapshot.healthStatus !== "ok"
              ? snapshot.healthMessage ?? "Lane times may be stale."
              : "No fresh Brunswick snapshot has arrived for over 2 minutes. Check the watcher and Remote Desktop window."}
          </p>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <div className={styles.eyebrow}>
            <span
              className={`${styles.feedLight} ${
                feedUnavailable ? styles.feedLightAlert : styles.feedLightLive
              }`}
              aria-hidden="true"
            />
            Brunswick feed
          </div>
          <h2 className={styles.title}>Bowling lanes</h2>
          <p className={styles.feedMeta}>
            {freshnessLabel(snapshot, nowMs)} · {activeQueueCount} waiting
          </p>
        </div>

        <div className={styles.metrics}>
          <div className={styles.availabilityMetric}>
            <div
              className={`${styles.availabilityRing} ${
                feedUnavailable ? styles.availabilityRingUnavailable : ""
              }`}
              style={{ "--availability-degrees": `${availabilityDegrees}deg` } as CSSProperties}
              aria-hidden="true"
            >
              <span>{feedUnavailable ? "--" : openLaneCount}</span>
            </div>
            <div>
              <span className={styles.metricLabel}>Available</span>
              <strong className={styles.metricValue}>
                {feedUnavailable ? "--" : openLaneCount} / {laneViews.length || 12}
              </strong>
            </div>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>In use</span>
            <strong className={styles.metricValue}>
              {feedUnavailable ? "--" : occupiedLaneCount}
            </strong>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Reserved</span>
            <strong className={styles.metricValue}>
              {feedUnavailable ? "--" : reservedLaneCount}
            </strong>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Next start</span>
            <strong className={styles.metricValue}>
              {plan.assignments[0]
                ? formatDuration(plan.assignments[0].startInSeconds)
                : "No queue"}
            </strong>
          </div>
        </div>
      </header>

      <div className={styles.legend} aria-label="Lane status legend">
        <span><i className={styles.legendOpen} />Open</span>
        <span><i className={styles.legendOccupied} />In use</span>
        <span><i className={styles.legendReserved} />Reserved</span>
        <span><i className={styles.legendWarning} />Do not use</span>
        <small>Click a lane to view details</small>
      </div>

      <div className={styles.laneBank}>
        <div className={styles.sceneScroll}>
          <div className={styles.scene} data-scene-ready={sceneReady}>
            <BowlingLaneScene
              lanes={sceneLanes}
              selectedLane={selectedLaneNumber}
              onSelectLane={setSelectedLaneNumber}
              onReady={setSceneReady}
            />
          </div>
        </div>
        <div className={styles.laneGrid} aria-label="Bowling lane status">
          {laneViews.map((laneView) => {
            const {
              lane,
              assignment,
              activeReservation,
              protectedReservation,
              nextReservation,
              reservationWarning,
              displayStatus,
              value,
            } = laneView;
            const reservationText = nextReservation
              ? eventReservationLabel(
                  nextReservation,
                  Boolean(activeReservation),
                  Boolean(protectedReservation),
                )
              : null;
            const overviewReservationText = reservationWarning
              ? reservationText?.replace("DO NOT USE · ", "")
              : reservationText;
            const accessibleStatus =
              displayStatus === "occupied"
                ? `In use, ${value} remaining`
                : statusName(displayStatus);
            const accessibleLabel = [
              `Lane ${lane.lane}`,
              accessibleStatus,
              reservationWarning ? "Do not use" : null,
              nextReservation?.eventName,
              reservationText,
              assignment
                ? `Party ${assignment.order}, ${assignment.name}, ${
                    assignment.startInSeconds === 0
                      ? "place now"
                      : `in ${formatDuration(assignment.startInSeconds)}`
                  }`
                : "No pending party",
            ]
              .filter(Boolean)
              .join(", ");

            return (
              <button
                key={lane.lane}
                type="button"
                aria-label={accessibleLabel}
                aria-pressed={selectedLaneNumber === lane.lane}
                data-status={displayStatus}
                data-warning={reservationWarning ? "true" : "false"}
                className={styles.laneButton}
                onClick={() => setSelectedLaneNumber(lane.lane)}
              >
                <span className={styles.laneHeader}>
                  <span><small>Lane</small> {lane.lane.toString().padStart(2, "0")}</span>
                  <strong>{value}</strong>
                </span>

                {reservationWarning && (
                  <span className={styles.warningRibbon}>DO NOT USE</span>
                )}

                <span className={styles.statusLine}>
                  <i />
                  {reservationWarning ? "Do not use" : statusName(displayStatus)}
                </span>

                {!feedUnavailable && lane.status === "reserved" && lane.reservationLabel && (
                  <span className={styles.brunswickReservation}>
                    {lane.reservationLabel}
                  </span>
                )}

                {nextReservation && (
                  <span
                    className={`${styles.eventBadge} ${
                      reservationWarning ? styles.eventBadgeWarning : styles.eventBadgeUpcoming
                    }`}
                  >
                    <strong>{nextReservation.eventName}</strong>
                    <small>{overviewReservationText}</small>
                  </span>
                )}

                {assignment ? (
                  <span className={styles.assignmentBadge}>
                    <strong>#{assignment.order} {assignment.name}</strong>
                    <small>
                      {assignment.startInSeconds === 0
                        ? "Place now"
                        : `In ${formatDuration(assignment.startInSeconds)}`}
                    </small>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedLane && (
        <article className={styles.laneDetail} aria-live="polite">
          <div className={styles.detailHeading}>
            <div>
              <span className={styles.detailEyebrow}>Selected lane</span>
              <h3>Lane {selectedLane.lane.lane}</h3>
            </div>
            <span
              className={styles.detailStatus}
              data-status={selectedLane.reservationWarning ? "warning" : selectedLane.displayStatus}
            >
              <i />
              {selectedLane.reservationWarning ? "DO NOT USE" : statusName(selectedLane.displayStatus)}
            </span>
          </div>

          <div className={styles.detailGrid}>
            <div className={styles.detailCell}>
              <span>Lane status</span>
              <strong className={styles.selectedCountdown}>{selectedLane.value}</strong>
              {!feedUnavailable && selectedLane.lane.status === "reserved" &&
                selectedLane.lane.reservationLabel && (
                  <small>{selectedLane.lane.reservationLabel}</small>
                )}
            </div>

            <div className={styles.detailCell}>
              <span>Reservation</span>
              {selectedLane.nextReservation ? (
                <>
                  <strong>{selectedLane.nextReservation.eventName}</strong>
                  <small className={selectedLane.reservationWarning ? styles.detailWarning : ""}>
                    {selectedReservationText}
                  </small>
                </>
              ) : (
                <strong>No upcoming reservation</strong>
              )}
            </div>

            <div className={styles.detailCell}>
              <span>Pending party</span>
              {selectedLane.assignment ? (
                <>
                  <strong>#{selectedLane.assignment.order} {selectedLane.assignment.name}</strong>
                  <small>
                    {selectedLane.assignment.startInSeconds === 0
                      ? "Place now"
                      : `In ${formatDuration(selectedLane.assignment.startInSeconds)}`}
                  </small>
                </>
              ) : (
                <strong>No pending party</strong>
              )}
            </div>
          </div>
        </article>
      )}

      <div className={styles.placementPanel}>
        <div className={styles.sectionHeading}>
          <h3>Placement order</h3>
          <span>{plan.assignments.length}</span>
        </div>
        {plan.assignments.length === 0 ? (
          <p className={styles.emptyState}>No bowling parties waiting</p>
        ) : (
          <ul className={styles.placementList}>
            {plan.assignments.map((assignment) => (
              <li key={assignment.entryId}>
                <span className={styles.orderNumber}>{assignment.order}</span>
                <div className={styles.partySummary}>
                  <strong>#{assignment.order} {assignment.name}</strong>
                  <small>
                    {formatBookingSummary(
                      "bowling",
                      assignment.laneCount,
                      assignment.sessionMinutes,
                    )}
                  </small>
                </div>
                <div className={styles.assignmentSummary}>
                  <strong>Lanes {assignment.laneNumbers.join(", ")}</strong>
                  <small>
                    {assignment.startInSeconds === 0
                      ? "Now"
                      : `In ${formatDuration(assignment.startInSeconds)}`}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan.unassigned.length > 0 && (
        <div className={styles.capacityAlert} role="alert">
          Not enough readable lanes for {plan.unassigned.length} party
          {plan.unassigned.length === 1 ? "" : "ies"}
        </div>
      )}
    </section>
  );
}
