"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIcon } from "@/components/ActivityIcon";
import { BookingOptions } from "@/components/BookingOptions";
import { BowlingPlanner } from "@/components/BowlingPlanner";
import {
  DartsPlanner,
  type DartActiveControl,
} from "@/components/DartsPlanner";
import { TimedResourcePlanner } from "@/components/TimedResourcePlanner";
import { EntertainmentReservations } from "@/components/EntertainmentReservations";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import {
  defaultSessionMinutesFor,
  formatBookingSummary,
  laneCountOptions,
  normalizeLaneCount,
  sessionOptionsFor,
} from "@/lib/booking";
import type { BowlingLaneSnapshot } from "@/lib/bowling-lanes";
import type { DartseeLaneSnapshot } from "@/lib/dartsee-lanes";
import {
  DARTSEE_EMPLOYEE_ALERT_AFTER_MS,
  DARTSEE_SUSTAINED_FAILURE_REFRESHES,
} from "@/lib/dartsee-feed-presentation";
import {
  TIMED_RESOURCES,
  type TimedResourceSession,
  type TimedResourceType,
} from "@/lib/resource-sessions";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  ACTIVITY_THEME,
  type Activity,
  type LaneCount,
  type SessionDuration,
  type WaitlistEntry,
} from "@/lib/types";

const SOUND_STORAGE_KEY = "onpar-staff-sound";
const STAFF_CHIME_PATH = "/sounds/new-guest-alert.wav";
const STAFF_SECRET_STORAGE_KEY = "onpar-staff-secret";
const BOWLING_STALE_AFTER_MS = 2 * 60_000;
const STAFF_QUEUE_TIMEOUT_MS = 5_000;
const STAFF_INTEGRATION_TIMEOUT_MS = 5_000;
const STAFF_QUEUE_STALE_AFTER_MS = 45_000;
const SCHEDULE_PROTECTION_STALE_AFTER_MS = 120_000;
const EVENT_HOST_OUTDATED_WARNING_AFTER_MS = 20 * 60_000;
const RESOURCE_SESSIONS_STALE_AFTER_MS = 45_000;
const DART_CONTROL_CLIENT_TIMEOUT_MS = 25_000;
const DART_CONTROL_CONFIRMED_GUARD_MS = 60_000;
const ARCHIVE_PAGE_SIZE = 25;
type StaffTab = "queue" | "bowling" | "darts" | "pool" | "shuffleboard";
type DartControlAction = "start" | "extend" | "end" | "override";
type DartPendingControl = {
  action: DartControlAction;
  lane: number;
  verifyAfterMs: number;
  untilMs: number;
  expectedSessionId?: string;
  expectedSessionEnd?: string;
  timedOut?: boolean;
};
type DartLaneOverride = {
  reading: DartseeLaneSnapshot["lanes"][number];
  confirmedAtMs: number;
  releaseAfterMs: number;
};
type StaffArchiveEntry = Pick<
  WaitlistEntry,
  "id" | "activity" | "name" | "phone" | "status" | "createdAt"
>;

function staffHeadersFor(secret: string) {
  return {
    "Content-Type": "application/json",
    "x-staff-secret": secret,
  };
}

async function fetchStaffEndpoint(
  endpoint: string,
  secret: string,
  parentSignal: AbortSignal,
  timeoutMs: number,
): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener("abort", abort, { once: true });
  }
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: staffHeadersFor(secret),
      signal: controller.signal,
    });
    const data = await response.json();
    return { response, data };
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abort);
  }
}

async function postDartControl(
  endpoint: string,
  requestHeaders: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    DART_CONTROL_CLIENT_TIMEOUT_MS,
  );
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function activeEntryIds(
  queues: { activity: Activity; queue: WaitlistEntry[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const { queue } of queues) {
    for (const entry of queue) {
      if (entry.status === "waiting" || entry.status === "notified") {
        ids.add(entry.id);
      }
    }
  }
  return ids;
}

function sessionCountdown(endsAt: string, nowMs: number): string {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - nowMs) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function notificationElapsed(notifiedAt: string | undefined, nowMs: number): string {
  if (!notifiedAt) return "just now";
  const timestamp = new Date(notifiedAt).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function smsStatusLabel(status?: string, errorCode?: string): string | null {
  if (!status) return null;
  if (status === "delivered") return "Delivered";
  if (status === "sent") return "Sent to carrier";
  if (status === "queued" || status === "accepted") return "Sending";
  if (status === "failed" || status === "undelivered") {
    return errorCode === "21610" ? "Blocked — opted out" : "Text not delivered";
  }
  return status.replaceAll("_", " ");
}

function smsStatusClass(status?: string): string {
  if (status === "delivered") return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  if (status === "failed" || status === "undelivered") {
    return "border-red-400/40 bg-red-500/15 text-red-200";
  }
  return "border-sky-400/30 bg-sky-500/15 text-sky-200";
}

function snapshotWithConfirmedDartLane(
  snapshot: DartseeLaneSnapshot,
  reading: DartseeLaneSnapshot["lanes"][number],
  confirmedAtMs: number,
): DartseeLaneSnapshot {
  const priorCapturedAtMs = new Date(snapshot.capturedAt).getTime();
  const captureBasisOffsetSeconds = Number.isFinite(priorCapturedAtMs)
    ? Math.floor((confirmedAtMs - priorCapturedAtMs) / 1000)
    : 0;
  return {
    ...snapshot,
    lanes: snapshot.lanes.map((lane) => {
      if (lane.lane !== reading.lane) return lane;
      return reading.status === "occupied"
        ? {
            ...reading,
            // The snapshot retains its original capture time. Store the new
            // reading on that same time basis so the planner's normal aging
            // produces the just-confirmed live countdown exactly once.
            remainingSeconds: Math.max(
              0,
              reading.remainingSeconds + captureBasisOffsetSeconds,
            ),
          }
        : reading;
    }),
  };
}

function dartControlCheckedAtMs(value: string | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function dartseeSnapshotStateVersionMs(snapshot: DartseeLaneSnapshot): number {
  const explicit = snapshot.stateVersionAt
    ? new Date(snapshot.stateVersionAt).getTime()
    : Number.NaN;
  if (Number.isFinite(explicit)) return explicit;
  return new Date(snapshot.capturedAt).getTime();
}

function dartseeLaneStateVersionMs(
  snapshot: DartseeLaneSnapshot,
  laneNumber: number,
): number {
  const reading = snapshot.lanes.find((lane) => lane.lane === laneNumber);
  const observedAtMs = reading?.observedAt
    ? new Date(reading.observedAt).getTime()
    : Number.NaN;
  if (Number.isFinite(observedAtMs)) return observedAtMs;
  const completeLegacySnapshot =
    snapshot.healthStatus === "ok" &&
    snapshot.knownLaneCount === snapshot.lanes.length &&
    reading?.status !== "unknown";
  return completeLegacySnapshot
    ? dartseeSnapshotStateVersionMs(snapshot)
    : Number.NEGATIVE_INFINITY;
}

function dartLaneMatchesConfirmedOverride(
  incoming: DartseeLaneSnapshot["lanes"][number] | undefined,
  confirmed: DartseeLaneSnapshot["lanes"][number],
): boolean {
  if (!incoming || incoming.status !== confirmed.status) return false;
  if (confirmed.status !== "occupied" || !confirmed.sessionId) return true;
  const incomingEndMs = incoming.sessionEnd
    ? new Date(incoming.sessionEnd).getTime()
    : Number.NaN;
  const confirmedEndMs = confirmed.sessionEnd
    ? new Date(confirmed.sessionEnd).getTime()
    : Number.NaN;
  return (
    incoming.sessionId === confirmed.sessionId &&
    (!confirmed.sessionEnd ||
      (Number.isFinite(incomingEndMs) && incomingEndMs >= confirmedEndMs))
  );
}

export default function StaffPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [queues, setQueues] = useState<
    { activity: Activity; queue: WaitlistEntry[] }[]
  >([]);
  const [bowlingSnapshot, setBowlingSnapshot] =
    useState<BowlingLaneSnapshot | null>(null);
  const [dartseeSnapshot, setDartseeSnapshot] =
    useState<DartseeLaneSnapshot | null>(null);
  const [resourceSessions, setResourceSessions] = useState<
    TimedResourceSession[]
  >([]);
  const [entertainmentReservations, setEntertainmentReservations] = useState<
    EntertainmentReservation[]
  >([]);
  const [resourceBusyKey, setResourceBusyKey] = useState<string | null>(null);
  const [dartActiveControl, setDartActiveControl] =
    useState<DartActiveControl | null>(null);
  const [dartPendingControls, setDartPendingControls] = useState<
    DartPendingControl[]
  >([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [queueUpdatedAtMs, setQueueUpdatedAtMs] = useState<number | null>(null);
  const [queueRefreshError, setQueueRefreshError] = useState(false);
  const [scheduleUpdatedAtMs, setScheduleUpdatedAtMs] = useState<number | null>(
    null,
  );
  const [scheduleReportedStale, setScheduleReportedStale] = useState(true);
  const [scheduleRefreshError, setScheduleRefreshError] = useState(false);
  const [resourceSessionsUpdatedAtMs, setResourceSessionsUpdatedAtMs] =
    useState<number | null>(null);
  const [resourceSessionsRefreshError, setResourceSessionsRefreshError] =
    useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editLaneCount, setEditLaneCount] = useState<LaneCount>(1);
  const [editSessionMinutes, setEditSessionMinutes] =
    useState<SessionDuration>(60);
  const [editSaving, setEditSaving] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [staffTab, setStaffTab] = useState<StaffTab>("queue");

  const knownIdsRef = useRef<Set<string> | null>(null);
  const chimeRef = useRef<HTMLAudioElement | null>(null);
  const refreshSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const archiveSequenceRef = useRef(0);
  const archiveControllerRef = useRef<AbortController | null>(null);
  const dartLaneOverridesRef = useRef<Map<number, DartLaneOverride>>(
    new Map(),
  );
  const dartPendingControlsRef = useRef<Map<number, DartPendingControl>>(
    new Map(),
  );

  const [addActivity, setAddActivity] = useState<Activity>("bowling");
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName, setAddLastName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addSms, setAddSms] = useState(false);
  const [addLaneCount, setAddLaneCount] = useState<LaneCount>(1);
  const [addSessionMinutes, setAddSessionMinutes] =
    useState<SessionDuration>(defaultSessionMinutesFor("bowling"));
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [servedOpen, setServedOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveEntries, setArchiveEntries] = useState<StaffArchiveEntry[]>([]);
  const [archivePage, setArchivePage] = useState(1);
  const [archiveHasMore, setArchiveHasMore] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const headers = useCallback(
    () => staffHeadersFor(secret),
    [secret],
  );

  const updateDartPendingControl = useCallback(
    (lane: number, next: DartPendingControl | null) => {
      if (next) dartPendingControlsRef.current.set(lane, next);
      else dartPendingControlsRef.current.delete(lane);
      setDartPendingControls(
        [...dartPendingControlsRef.current.values()].sort(
          (left, right) => left.lane - right.lane,
        ),
      );
    },
    [],
  );

  const applyDartseeSnapshot = useCallback(
    (incoming: DartseeLaneSnapshot) => {
      let pendingChanged = false;
      for (const pending of dartPendingControlsRef.current.values()) {
        const pendingReading = incoming.lanes.find(
          (reading) => reading.lane === pending.lane,
        );
        const incomingLaneVersionMs = dartseeLaneStateVersionMs(
          incoming,
          pending.lane,
        );
        const freshForPending =
          Number.isFinite(incomingLaneVersionMs) &&
          incomingLaneVersionMs >= pending.verifyAfterMs;
        const pendingReadingEndMs = pendingReading?.sessionEnd
          ? new Date(pendingReading.sessionEnd).getTime()
          : Number.NaN;
        const expectedPendingEndMs = pending.expectedSessionEnd
          ? new Date(pending.expectedSessionEnd).getTime()
          : Number.NaN;
        const expectedPendingState = pending.action === "start"
          ? pendingReading?.status === "occupied"
          : pending.action === "end"
            ? pendingReading?.status === "open"
            : pending.action === "extend"
              ? pendingReading?.status === "occupied" &&
                Boolean(pending.expectedSessionId) &&
                pendingReading.sessionId === pending.expectedSessionId &&
                Number.isFinite(expectedPendingEndMs) &&
                Number.isFinite(pendingReadingEndMs) &&
                pendingReadingEndMs >= expectedPendingEndMs
              : false;
        const settledOppositeState =
          incomingLaneVersionMs >= pending.untilMs &&
          (pendingReading?.status === "open" ||
            pendingReading?.status === "occupied");
        if (
          freshForPending &&
          (expectedPendingState || settledOppositeState)
        ) {
          dartPendingControlsRef.current.delete(pending.lane);
          pendingChanged = true;
        }
      }
      if (pendingChanged) {
        setDartPendingControls(
          [...dartPendingControlsRef.current.values()].sort(
            (left, right) => left.lane - right.lane,
          ),
        );
      }

      let nextSnapshot = incoming;
      for (const [lane, override] of dartLaneOverridesRef.current) {
        const incomingReading = incoming.lanes.find(
          (reading) => reading.lane === lane,
        );
        const incomingLaneVersionMs = dartseeLaneStateVersionMs(incoming, lane);
        const exactLaneEvidence =
          Number.isFinite(incomingLaneVersionMs) &&
          incomingLaneVersionMs >= override.confirmedAtMs;
        const confirmedStateReached = dartLaneMatchesConfirmedOverride(
          incomingReading,
          override.reading,
        );
        if (
          exactLaneEvidence &&
          (confirmedStateReached ||
            incomingLaneVersionMs >= override.releaseAfterMs)
        ) {
          dartLaneOverridesRef.current.delete(lane);
          continue;
        }
        nextSnapshot = snapshotWithConfirmedDartLane(
          nextSnapshot,
          override.reading,
          override.confirmedAtMs,
        );
      }
      setDartseeSnapshot(nextSnapshot);
    },
    [],
  );

  const loadStaffData = useCallback(
    async (staffSecret: string, showLoading = true) => {
      if (!staffSecret) return;

      refreshControllerRef.current?.abort();
      const controller = new AbortController();
      refreshControllerRef.current = controller;
      const sequence = ++refreshSequenceRef.current;
      if (showLoading) setLoading(true);
      try {
        const queueResult = await fetchStaffEndpoint(
          "/api/staff/queue",
          staffSecret,
          controller.signal,
          STAFF_QUEUE_TIMEOUT_MS,
        );
        if (sequence !== refreshSequenceRef.current) return;
        if (queueResult.response.status === 401) {
          setAuthenticated(false);
          setQueueRefreshError(false);
          sessionStorage.removeItem(STAFF_SECRET_STORAGE_KEY);
          return;
        }
        if (!queueResult.response.ok) {
          throw new Error("Could not refresh the staff queue");
        }

        const queueData = queueResult.data as {
          queues?: { activity: Activity; queue: WaitlistEntry[] }[];
        };
        if (sequence !== refreshSequenceRef.current) return;
        setQueues(queueData.queues ?? []);
        setQueueUpdatedAtMs(Date.now());
        setQueueRefreshError(false);
        setAuthenticated(true);
        sessionStorage.setItem(STAFF_SECRET_STORAGE_KEY, staffSecret);

        const loadIntegration = async (
          endpoint: string,
          applyData: (data: unknown) => void,
        ) => {
          const result = await fetchStaffEndpoint(
            endpoint,
            staffSecret,
            controller.signal,
            STAFF_INTEGRATION_TIMEOUT_MS,
          );
          if (!result.response.ok) {
            throw new Error(`Could not refresh ${endpoint}`);
          }
          if (sequence !== refreshSequenceRef.current) return;
          applyData(result.data);
        };

        const loadSchedule = async () => {
          try {
            await loadIntegration(
              "/api/staff/entertainment-schedule",
              (value) => {
                const data = value as {
                  schedule?: {
                    reservations?: EntertainmentReservation[];
                  } | null;
                  dataUpdatedAt?: string;
                  stale?: boolean;
                };
                if (Array.isArray(data.schedule?.reservations)) {
                  setEntertainmentReservations(data.schedule.reservations);
                }
                const updatedAt = data.dataUpdatedAt
                  ? new Date(data.dataUpdatedAt).getTime()
                  : Number.NaN;
                if (Number.isFinite(updatedAt)) {
                  setScheduleUpdatedAtMs(updatedAt);
                }
                setScheduleReportedStale(
                  Boolean(data.stale) || !Number.isFinite(updatedAt),
                );
                setScheduleRefreshError(false);
              },
            );
          } catch {
            if (sequence === refreshSequenceRef.current) {
              // Keep the last-known reservations visible, but make it clear that
              // staff cannot trust reservation protection until this recovers.
              setScheduleRefreshError(true);
            }
          }
        };

        const loadResourceSessions = async () => {
          try {
            await loadIntegration("/api/staff/resource-sessions", (value) => {
              const data = value as { sessions?: TimedResourceSession[] };
              if (!Array.isArray(data.sessions)) {
                throw new Error("Invalid timed-resource session response");
              }
              setResourceSessions(data.sessions);
              setResourceSessionsUpdatedAtMs(Date.now());
              setResourceSessionsRefreshError(false);
            });
          } catch {
            if (sequence === refreshSequenceRef.current) {
              // Never replace known pool/shuffleboard sessions with an empty
              // error response; staff must see that the snapshot is delayed.
              setResourceSessionsRefreshError(true);
            }
          }
        };

        await Promise.allSettled([
          loadIntegration("/api/staff/bowling-lanes", (value) => {
            const data = value as { snapshot?: BowlingLaneSnapshot | null };
            if (data.snapshot) setBowlingSnapshot(data.snapshot);
          }),
          loadIntegration("/api/staff/dart-lanes", (value) => {
            const data = value as { snapshot?: DartseeLaneSnapshot | null };
            if (data.snapshot) applyDartseeSnapshot(data.snapshot);
          }),
          loadResourceSessions(),
          loadSchedule(),
        ]);
      } catch {
        // Preserve the current queue and integration snapshots. A later manual
        // or scheduled refresh retries without logging staff out on a blip.
        if (sequence === refreshSequenceRef.current) {
          setQueueRefreshError(true);
        }
      } finally {
        if (refreshControllerRef.current === controller) {
          refreshControllerRef.current = null;
        }
        if (sequence === refreshSequenceRef.current) setLoading(false);
      }
    },
    [applyDartseeSnapshot],
  );

  const fetchQueues = useCallback(
    async (showLoading = true) => loadStaffData(secret, showLoading),
    [loadStaffData, secret],
  );

  const playStaffChime = useCallback(async () => {
    const audio = chimeRef.current;
    if (!audio) {
      setSoundReady(false);
      setSoundError("The new-guest alert sound could not be loaded.");
      return false;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      await audio.play();
      setSoundReady(true);
      setSoundError(null);
      return true;
    } catch (error) {
      setSoundReady(false);
      setSoundError(
        "Sound was blocked. Unmute this browser tab and this Mac, then tap Enable & test sound.",
      );
      console.warn("[staff] chime blocked or failed", error);
      return false;
    }
  }, []);

  async function enableSound() {
    sessionStorage.setItem(SOUND_STORAGE_KEY, "1");
    setSoundOn(true);
    await playStaffChime();
  }

  function disableSound() {
    const audio = chimeRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    sessionStorage.setItem(SOUND_STORAGE_KEY, "0");
    setSoundOn(false);
    setSoundReady(false);
    setSoundError(null);
  }

  const loadArchive = useCallback(
    async (
      staffSecret: string,
      query: string,
      page: number,
      append = false,
    ) => {
      if (!staffSecret) return;
      archiveControllerRef.current?.abort();
      const controller = new AbortController();
      archiveControllerRef.current = controller;
      const sequence = ++archiveSequenceRef.current;
      setArchiveLoading(true);
      setArchiveError(null);
      if (!append) {
        setArchiveEntries([]);
        setArchiveHasMore(false);
      }
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          page: String(page),
          pageSize: String(ARCHIVE_PAGE_SIZE),
        });
        const result = await fetchStaffEndpoint(
          `/api/staff/archive?${params.toString()}`,
          staffSecret,
          controller.signal,
          STAFF_QUEUE_TIMEOUT_MS,
        );
        if (sequence !== archiveSequenceRef.current) return;
        if (result.response.status === 401) {
          setAuthenticated(false);
          sessionStorage.removeItem(STAFF_SECRET_STORAGE_KEY);
          return;
        }
        if (!result.response.ok) throw new Error("Archive search failed");
      const data = result.data as {
          entries?: StaffArchiveEntry[];
          page?: number;
          hasMore?: boolean;
        };
        const nextEntries = Array.isArray(data.entries) ? data.entries : [];
        setArchiveEntries((current) => {
          if (!append) return nextEntries;
          const byId = new Map(current.map((entry) => [entry.id, entry]));
          for (const entry of nextEntries) byId.set(entry.id, entry);
          return [...byId.values()];
        });
        setArchivePage(data.page ?? page);
        setArchiveHasMore(Boolean(data.hasMore));
      } catch {
        if (
          sequence === archiveSequenceRef.current &&
          !controller.signal.aborted
        ) {
          setArchiveError("Could not load the archive. Try again.");
        }
      } finally {
        if (archiveControllerRef.current === controller) {
          archiveControllerRef.current = null;
        }
        if (sequence === archiveSequenceRef.current) setArchiveLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const soundTimeout = window.setTimeout(() => {
      const savedPreference = sessionStorage.getItem(SOUND_STORAGE_KEY);
      const shouldEnableSound = savedPreference !== "0";
      if (savedPreference === null) {
        sessionStorage.setItem(SOUND_STORAGE_KEY, "1");
      }
      setSoundOn(shouldEnableSound);
    }, 0);
    const audio = new Audio(STAFF_CHIME_PATH);
    audio.volume = 1;
    audio.preload = "auto";
    chimeRef.current = audio;
    return () => {
      window.clearTimeout(soundTimeout);
      audio.pause();
      chimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(STAFF_SECRET_STORAGE_KEY);
    if (!saved) return;

    const authTimeout = window.setTimeout(() => {
      setSecret(saved);
      void loadStaffData(saved);
    }, 0);

    return () => window.clearTimeout(authTimeout);
  }, [loadStaffData]);

  useEffect(() => {
    return () => {
      refreshSequenceRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      archiveSequenceRef.current += 1;
      archiveControllerRef.current?.abort();
      archiveControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!authenticated || !archiveOpen || !secret) return;
    const delay = archiveQuery.trim() ? 300 : 0;
    const timeout = window.setTimeout(() => {
      void loadArchive(secret, archiveQuery, 1);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      archiveSequenceRef.current += 1;
      archiveControllerRef.current?.abort();
      archiveControllerRef.current = null;
    };
  }, [archiveOpen, archiveQuery, authenticated, loadArchive, secret]);

  useEffect(() => {
    if (!authenticated) {
      knownIdsRef.current = null;
      return;
    }
    const interval = setInterval(() => {
      void fetchQueues(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [authenticated, fetchQueues]);

  useEffect(() => {
    const timeouts = dartPendingControls
      .filter((pending) => !pending.timedOut)
      .map((pending) =>
        window.setTimeout(() => {
          const current = dartPendingControlsRef.current.get(pending.lane);
          if (current?.action === pending.action) {
            updateDartPendingControl(pending.lane, {
              ...current,
              timedOut: true,
            });
            void fetchQueues(false);
          }
        }, Math.max(0, pending.untilMs - Date.now())),
      );
    return () => timeouts.forEach((timeout) => window.clearTimeout(timeout));
  }, [dartPendingControls, fetchQueues, updateDartPendingControl]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const nextIds = activeEntryIds(queues);
    if (knownIdsRef.current === null) {
      knownIdsRef.current = nextIds;
      return;
    }
    const seenIds = knownIdsRef.current;
    let hasNew = false;
    for (const id of nextIds) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        hasNew = true;
      }
    }
    if (!hasNew || !soundOn || !soundReady) return;
    void playStaffChime();
  }, [queues, authenticated, playStaffChime, soundOn, soundReady]);

  async function staffAction(endpoint: string, id: string) {
    setActionId(id);
    try {
      let res = await fetch(endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id }),
      });
      let data = await res.json();
      if (
        res.status === 409 &&
        data.code === "SMS_CONSENT_REQUIRED" &&
        window.confirm(
          "This older entry does not have recorded SMS consent. Confirm that the guest agreed to receive waitlist texts, then resend?",
        )
      ) {
        res = await fetch(endpoint, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ id, confirmSmsConsent: true }),
        });
        data = await res.json();
      }
      if (!res.ok) {
        alert(data.error ?? "Action failed");
        return;
      }
      if (endpoint.includes("notify") && data.smsSent === false) {
        alert("Guest was marked called, but the text could not be sent. Check the SMS status on their card and confirm the phone number.");
      }
      if (endpoint.includes("recall") && data.resentSms === false) {
        alert("The ready text was not resent. Check the guest's SMS consent and phone number.");
      }
      await fetchQueues();
      if (endpoint.includes("archive") && archiveOpen) {
        await loadArchive(secret, archiveQuery, 1);
      }
      if (
        endpoint.includes("notify") ||
        endpoint.includes("recall") ||
        endpoint.includes("serve") ||
        endpoint.includes("remove") ||
        endpoint.includes("archive")
      ) {
        setSelectedId(null);
      }
    } finally {
      setActionId(null);
    }
  }

  function beginEdit(entry: WaitlistEntry) {
    setEditId(entry.id);
    setEditPhone(entry.phone);
    setEditLaneCount(entry.laneCount);
    setEditSessionMinutes(entry.sessionMinutes);
  }

  async function saveGuestEdit(event: React.FormEvent, entry: WaitlistEntry) {
    event.preventDefault();
    setEditSaving(true);
    try {
      const response = await fetch("/api/staff/edit", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          id: entry.id,
          phone: editPhone,
          laneCount: editLaneCount,
          sessionMinutes: editSessionMinutes,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error ?? "Could not update guest");
        return;
      }
      setEditId(null);
      await fetchQueues(false);
      alert(
        data.smsSent
          ? "Waitlist details updated and a new text was sent."
          : "Waitlist details updated. No text was sent because SMS is not enabled for this guest.",
      );
    } finally {
      setEditSaving(false);
    }
  }

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddStatus(null);
    try {
      const res = await fetch("/api/staff/add", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          activity: addActivity,
          firstName: addFirstName,
          lastName: addLastName,
          phone: addPhone,
          smsOptIn: addSms,
          rewardsOptIn: false,
          laneCount: addLaneCount,
          sessionMinutes: addSessionMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddStatus(data.error ?? "Could not add guest");
        return;
      }
      setAddStatus(
        `Added ${addFirstName} ${addLastName} to ${ACTIVITY_LABELS[addActivity]}${addSms ? (data.smsSent ? " · confirmation text queued" : " · confirmation text failed") : ""}`,
      );
      setAddFirstName("");
      setAddLastName("");
      setAddPhone("");
      setAddSms(false);
      setAddLaneCount(1);
      setAddSessionMinutes(defaultSessionMinutesFor(addActivity));
      await fetchQueues();
    } catch {
      setAddStatus("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function addResourceSession(input: {
    resourceType: TimedResourceType;
    resourceId: string;
    guestName: string;
    startsAt: string;
    durationMinutes: 30 | 60 | 120;
  }): Promise<boolean> {
    const key = `${input.resourceType}:${input.resourceId}`;
    setResourceBusyKey(key);
    try {
      const res = await fetch("/api/staff/resource-sessions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Could not add session");
        return false;
      }
      await fetchQueues(false);
      setNowMs(Date.now());
      return true;
    } finally {
      setResourceBusyKey(null);
    }
  }

  async function clearResourceSession(
    resourceType: TimedResourceType,
    resourceId: string,
  ) {
    const key = `${resourceType}:${resourceId}`;
    setResourceBusyKey(key);
    try {
      const res = await fetch("/api/staff/resource-sessions", {
        method: "DELETE",
        headers: headers(),
        body: JSON.stringify({ resourceType, resourceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Could not clear session");
        return;
      }
      await fetchQueues(false);
      setNowMs(Date.now());
    } finally {
      setResourceBusyKey(null);
    }
  }

  async function startDartLane(
    lane: number,
    durationMinutes: 30 | 60 | 120,
    reservationOverride = false,
  ): Promise<boolean> {
    setDartActiveControl({ action: "start", lane, durationMinutes });
    try {
      const response = await postDartControl(
        "/api/staff/dart-lanes/start",
        headers(),
        {
          requestId: window.crypto.randomUUID(),
          lane,
          durationMinutes,
          reservationOverride,
        },
      );
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        confirmed?: boolean;
        checkedAt?: string;
        lane?: DartseeLaneSnapshot["lanes"][number] | null;
        snapshot?: DartseeLaneSnapshot | null;
      };
      if (!response.ok) {
        alert(data.error ?? "Could not start this dart lane.");
        return false;
      }

      if (!data.confirmed) {
        const verifyAfterMs = dartControlCheckedAtMs(data.checkedAt);
        updateDartPendingControl(lane, {
          action: "start",
          lane,
          verifyAfterMs,
          untilMs: verifyAfterMs + 30_000,
        });
        alert(
          data.message ??
            "The start may have been sent. Do not click Start again; check the lane while its status refreshes.",
        );
        window.setTimeout(() => void fetchQueues(false), 3_000);
        return true;
      }

      if (data.snapshot) {
        applyDartseeSnapshot(data.snapshot);
      } else if (data.lane) {
        const confirmedAtMs = dartControlCheckedAtMs(data.checkedAt);
        dartLaneOverridesRef.current.set(lane, {
          reading: data.lane,
          confirmedAtMs,
          releaseAfterMs:
            confirmedAtMs + DART_CONTROL_CONFIRMED_GUARD_MS,
        });
        updateDartPendingControl(lane, null);
        setDartseeSnapshot((current) =>
          current
            ? snapshotWithConfirmedDartLane(
                current,
                data.lane!,
                confirmedAtMs,
              )
            : current,
        );
      }
      setNowMs(Date.now());
      return true;
    } catch {
      const verifyAfterMs = Date.now();
      updateDartPendingControl(lane, {
        action: "start",
        lane,
        verifyAfterMs,
        untilMs: verifyAfterMs + 30_000,
      });
      alert(
        "The connection was interrupted. Do not click Start again until the lane status refreshes.",
      );
      window.setTimeout(() => void fetchQueues(false), 3_000);
      return false;
    } finally {
      setDartActiveControl(null);
    }
  }

  async function overrideDartLane(
    lane: number,
    durationMinutes: number,
  ): Promise<boolean> {
    setDartActiveControl({ action: "override", lane, durationMinutes });
    try {
      const response = await postDartControl(
        "/api/staff/dart-lanes/override",
        headers(),
        {
          requestId: window.crypto.randomUUID(),
          lane,
          durationMinutes,
        },
      );
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        action?: "start" | "extend";
        confirmed?: boolean;
        checkedAt?: string;
        expectedSessionId?: string;
        expectedSessionEnd?: string;
        lane?: DartseeLaneSnapshot["lanes"][number] | null;
        snapshot?: DartseeLaneSnapshot | null;
      };
      if (!response.ok) {
        alert(data.error ?? "Could not override this dart lane timer.");
        return false;
      }

      if (!data.confirmed) {
        const verifyAfterMs = dartControlCheckedAtMs(data.checkedAt);
        updateDartPendingControl(lane, {
          action: data.action === "extend" ? "extend" : "start",
          lane,
          verifyAfterMs,
          untilMs: verifyAfterMs + 30_000,
          expectedSessionId: data.expectedSessionId,
          expectedSessionEnd: data.expectedSessionEnd,
        });
        alert(
          data.message ??
            "The override may have been sent. Do not submit it again; check the lane while its status refreshes.",
        );
        window.setTimeout(() => void fetchQueues(false), 3_000);
        return true;
      }

      if (data.snapshot) {
        applyDartseeSnapshot(data.snapshot);
      } else if (data.lane) {
        const confirmedAtMs = dartControlCheckedAtMs(data.checkedAt);
        dartLaneOverridesRef.current.set(lane, {
          reading: data.lane,
          confirmedAtMs,
          releaseAfterMs:
            confirmedAtMs + DART_CONTROL_CONFIRMED_GUARD_MS,
        });
        updateDartPendingControl(lane, null);
        setDartseeSnapshot((current) =>
          current
            ? snapshotWithConfirmedDartLane(
                current,
                data.lane!,
                confirmedAtMs,
              )
            : current,
        );
      }
      setNowMs(Date.now());
      return true;
    } catch {
      const verifyAfterMs = Date.now();
      updateDartPendingControl(lane, {
        // The interrupted client does not know whether the server observed an
        // open or occupied lane. Keep a generic verification lock that cannot
        // clear merely because an old occupied snapshot arrives.
        action: "override",
        lane,
        verifyAfterMs,
        untilMs: verifyAfterMs + 30_000,
      });
      alert(
        "The connection was interrupted. Do not submit the override again until the lane status refreshes.",
      );
      window.setTimeout(() => void fetchQueues(false), 3_000);
      return false;
    } finally {
      setDartActiveControl(null);
    }
  }

  async function endDartLane(lane: number): Promise<boolean> {
    if (!window.confirm(`End the active session on Dart ${lane}?`)) {
      return false;
    }
    setDartActiveControl({ action: "end", lane });
    try {
      const response = await postDartControl(
        "/api/staff/dart-lanes/end",
        headers(),
        {
          requestId: window.crypto.randomUUID(),
          lane,
        },
      );
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        confirmed?: boolean;
        checkedAt?: string;
        lane?: DartseeLaneSnapshot["lanes"][number] | null;
        snapshot?: DartseeLaneSnapshot | null;
      };
      if (!response.ok) {
        alert(data.error ?? "Could not end this dart lane session.");
        return false;
      }
      if (!data.confirmed) {
        const verifyAfterMs = dartControlCheckedAtMs(data.checkedAt);
        updateDartPendingControl(lane, {
          action: "end",
          lane,
          verifyAfterMs,
          untilMs: verifyAfterMs + 30_000,
        });
        alert(
          data.message ??
            "The End command may have been sent. Do not click End again; check the lane while its status refreshes.",
        );
        window.setTimeout(() => void fetchQueues(false), 3_000);
        return true;
      }

      if (data.snapshot) {
        applyDartseeSnapshot(data.snapshot);
      } else if (data.lane) {
        const confirmedAtMs = dartControlCheckedAtMs(data.checkedAt);
        dartLaneOverridesRef.current.set(lane, {
          reading: data.lane,
          confirmedAtMs,
          releaseAfterMs:
            confirmedAtMs + DART_CONTROL_CONFIRMED_GUARD_MS,
        });
        updateDartPendingControl(lane, null);
        setDartseeSnapshot((current) =>
          current
            ? snapshotWithConfirmedDartLane(
                current,
                data.lane!,
                confirmedAtMs,
              )
            : current,
        );
      }
      setNowMs(Date.now());
      return true;
    } catch {
      const verifyAfterMs = Date.now();
      updateDartPendingControl(lane, {
        action: "end",
        lane,
        verifyAfterMs,
        untilMs: verifyAfterMs + 30_000,
      });
      alert(
        "The connection was interrupted. Do not click End again until the lane status refreshes.",
      );
      window.setTimeout(() => void fetchQueues(false), 3_000);
      return false;
    } finally {
      setDartActiveControl(null);
    }
  }

  const selectedEntry = queues
    .flatMap((q) => q.queue)
    .find((e) => e.id === selectedId);

  const allEntries = queues.flatMap((q) => q.queue);
  const servedRemoved = allEntries
    .filter(
      (e) =>
        e.status === "served" || e.status === "cancelled",
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 40);
  const resourceAlerts = resourceSessions.filter(
    (session) => new Date(session.endsAt).getTime() - nowMs <= 5 * 60_000,
  );
  const bowlingSnapshotAgeMs = bowlingSnapshot
    ? nowMs - new Date(bowlingSnapshot.capturedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const bowlingFeedStale =
    !Number.isFinite(bowlingSnapshotAgeMs) ||
    bowlingSnapshotAgeMs > BOWLING_STALE_AFTER_MS;
  const bowlingFeedNeedsAttention =
    !loading &&
    (!bowlingSnapshot ||
      bowlingSnapshot.healthStatus !== "ok" ||
      bowlingFeedStale);
  const dartseeSnapshotAgeMs = dartseeSnapshot
    ? nowMs - new Date(dartseeSnapshot.capturedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const dartseeFeedAlertStale =
    !Number.isFinite(dartseeSnapshotAgeMs) ||
    dartseeSnapshotAgeMs > DARTSEE_EMPLOYEE_ALERT_AFTER_MS;
  const dartseeHardFailure =
    dartseeSnapshot?.healthStatus === "auth-error";
  const dartseeSustainedFailure =
    dartseeSnapshot !== null &&
    dartseeSnapshot.healthStatus !== "ok" &&
    (dartseeSnapshot.consecutiveIncompleteRefreshes ?? 0) >=
      DARTSEE_SUSTAINED_FAILURE_REFRESHES;
  const dartseeFeedNeedsAttention =
    !loading &&
    (!dartseeSnapshot ||
      dartseeHardFailure ||
      dartseeSustainedFailure ||
      dartseeFeedAlertStale);
  const queueAgeMs = queueUpdatedAtMs === null
    ? Number.POSITIVE_INFINITY
    : nowMs - queueUpdatedAtMs;
  const queueFeedStale =
    authenticated &&
    (queueRefreshError ||
      (queueUpdatedAtMs !== null && queueAgeMs > STAFF_QUEUE_STALE_AFTER_MS));
  const scheduleAgeMs = scheduleUpdatedAtMs === null
    ? Number.POSITIVE_INFINITY
    : nowMs - scheduleUpdatedAtMs;
  const scheduleFeedNeedsAttention =
    authenticated &&
    !loading &&
    (!Number.isFinite(scheduleAgeMs) ||
      scheduleAgeMs > EVENT_HOST_OUTDATED_WARNING_AFTER_MS);
  const reservationProtectionReady =
    authenticated &&
    !scheduleRefreshError &&
    !scheduleReportedStale &&
    Number.isFinite(scheduleAgeMs) &&
    scheduleAgeMs <= SCHEDULE_PROTECTION_STALE_AFTER_MS;
  const resourceSessionsAgeMs = resourceSessionsUpdatedAtMs === null
    ? Number.POSITIVE_INFINITY
    : nowMs - resourceSessionsUpdatedAtMs;
  const resourceSessionsNeedAttention =
    authenticated &&
    !loading &&
    (resourceSessionsRefreshError ||
      !Number.isFinite(resourceSessionsAgeMs) ||
      resourceSessionsAgeMs > RESOURCE_SESSIONS_STALE_AFTER_MS);

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold text-white">Staff</h1>
        <p className="mt-2 text-sm text-neutral-400">Enter your staff password.</p>
        {queueRefreshError && (
          <p
            className="mt-4 rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-sm text-amber-100"
            role="alert"
          >
            Could not reach the staff queue. Check the connection and try again.
          </p>
        )}
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchQueues()}
          placeholder="Password"
          className="mt-6 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white"
        />
        <button
          type="button"
          onClick={() => void fetchQueues()}
          disabled={loading}
          className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-semibold text-neutral-900 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-24 sm:px-5">
      {soundOn && !soundReady && (
        <div
          className={`mb-5 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            soundError
              ? "border-red-400 bg-red-700 text-white shadow-red-950/30"
              : "border-amber-400/70 bg-amber-500/20 text-amber-50 shadow-amber-950/20"
          }`}
          role={soundError ? "alert" : "status"}
        >
          <span className="block font-semibold">
            {soundError ??
              "New-guest sound needs one tap after this dashboard opens."}
          </span>
          <span className="mt-1 block text-xs opacity-90">
            Tap the button to play a loud test. If the test is silent, unmute
            this browser tab and increase this Mac&apos;s output volume.
          </span>
          <button
            type="button"
            onClick={() => void enableSound()}
            className="mt-3 rounded-lg bg-white px-4 py-2 text-xs font-bold text-neutral-950 shadow-sm"
          >
            Enable &amp; test sound
          </button>
        </div>
      )}
      {queueFeedStale && (
        <div
          className="mb-5 rounded-xl border border-amber-400/60 bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-50"
          role="alert"
        >
          Queue refresh delayed — showing the last known guest list.
          <span className="mt-1 block text-xs font-normal text-amber-100/90">
            {queueUpdatedAtMs === null
              ? "Retrying now."
              : `Last successful update ${Math.max(1, Math.floor(queueAgeMs / 1_000))} seconds ago.`}
          </span>
        </div>
      )}
      {scheduleFeedNeedsAttention && (
        <div
          className="mb-5 rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Reservation schedule needs attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            Upcoming-event protection may be outdated. Keep the last-known
            reservations in place and do not assign any new lane or table until
            Event Host is verified.
            {scheduleUpdatedAtMs !== null && (
              <> Last good schedule was {Math.max(1, Math.floor(scheduleAgeMs / 60_000))} minute{Math.floor(scheduleAgeMs / 60_000) === 1 ? "" : "s"} ago.</>
            )}
          </span>
        </div>
      )}
      {resourceSessionsNeedAttention && (
        <div
          className="mb-5 rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Pool / shuffleboard sessions need attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            The table timers may be outdated. Keep the last-known sessions in
            place and verify the balls and pucks before assigning a pool table
            or shuffleboard.
          </span>
        </div>
      )}
      {bowlingFeedNeedsAttention && (
        <button
          type="button"
          onClick={() => setStaffTab("bowling")}
          className="mb-5 w-full rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Brunswick feed needs attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            {!bowlingSnapshot
              ? "No Brunswick snapshot is available. Confirm the watcher is running and check the Brunswick Remote Desktop window."
              : bowlingSnapshot.healthStatus !== "ok"
                ? (bowlingSnapshot.healthMessage ??
                  "Lane times may be stale. Check the Brunswick computer and Remote Desktop window.")
              : "No Brunswick snapshot has arrived for over 2 minutes. Confirm the watcher is running and check the Brunswick Remote Desktop window."}
          </span>
        </button>
      )}
      {dartseeFeedNeedsAttention && (
        <button
          type="button"
          onClick={() => setStaffTab("darts")}
          className="mb-5 w-full rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Dartsee feed needs attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            {!dartseeSnapshot
              ? "No Dartsee snapshot is available. Go check the Dartsee machine and Central dashboard."
              : dartseeFeedAlertStale
              ? "No fresh Dartsee snapshot has arrived for over 5 minutes. Go check the Dartsee machine and Central dashboard."
              : dartseeSnapshot.healthMessage ??
                "Dart lane status is incomplete. Check the Dartsee Central dashboard and the affected lane units."}
          </span>
        </button>
      )}
      {resourceAlerts.length > 0 && (
        <div className="mb-5 space-y-2" role="alert" aria-live="assertive">
          {resourceAlerts.map((session) => {
            const resource = TIMED_RESOURCES[session.resourceType].find(
              (item) => item.id === session.resourceId,
            );
            const ended = new Date(session.endsAt).getTime() <= nowMs;
            const equipment = session.resourceType === "pool" ? "balls" : "pucks";
            return (
              <button
                key={`${session.resourceType}:${session.resourceId}`}
                type="button"
                onClick={() => setStaffTab(session.resourceType)}
                className="w-full rounded-xl border border-red-400 bg-red-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-red-950/30"
              >
                {ended
                  ? `${resource?.label}: time is up for ${session.guestName}. Collect the ${equipment}, then clear the session.`
                  : `${resource?.label}: 5 minutes remaining for ${session.guestName}.`}
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Staff console</h1>
          <p className="text-xs text-neutral-500">Tap a guest to manage their spot</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={
              soundOn && soundReady
                ? disableSound
                : () => void enableSound()
            }
            aria-pressed={soundOn && soundReady}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              soundOn && soundReady
                ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                : soundOn
                  ? "border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                  : "border-red-400/60 bg-red-500/15 text-red-100 hover:bg-red-500/25"
            }`}
            title={
              soundOn && soundReady
                ? "Mute new-guest chime"
                : "Enable and test the new-guest chime"
            }
          >
            {soundOn && soundReady
              ? "Sound ready"
              : soundOn
                ? "Enable sound"
                : "Sound off"}
          </button>
          <button
            type="button"
            onClick={() => void fetchQueues()}
            disabled={loading}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-neutral-950 p-1 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => setStaffTab("queue")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            staffTab === "queue"
              ? "bg-white text-neutral-950"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Queue
        </button>
        <button
          type="button"
          onClick={() => setStaffTab("bowling")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            staffTab === "bowling"
              ? "bg-white text-neutral-950"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Bowling lanes
        </button>
        <button
          type="button"
          onClick={() => setStaffTab("darts")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            staffTab === "darts"
              ? "bg-white text-neutral-950"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Dart lanes
        </button>
        <button
          type="button"
          onClick={() => setStaffTab("pool")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            staffTab === "pool"
              ? "bg-white text-neutral-950"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Pool tables
        </button>
        <button
          type="button"
          onClick={() => setStaffTab("shuffleboard")}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            staffTab === "shuffleboard"
              ? "bg-white text-neutral-950"
              : "text-neutral-400 hover:text-white"
          }`}
        >
          Shuffleboards
        </button>
      </div>

      {staffTab === "bowling" && (
        <>
          <BowlingPlanner snapshot={bowlingSnapshot} entries={allEntries} reservations={entertainmentReservations} />
          <div className="mt-5">
            <EntertainmentReservations activity="bowling" reservations={entertainmentReservations} />
          </div>
        </>
      )}

      {staffTab === "darts" && (
        <>
          <DartsPlanner
            snapshot={dartseeSnapshot}
            entries={allEntries}
            reservations={entertainmentReservations}
            activeControl={dartActiveControl}
            pendingControls={dartPendingControls}
            reservationProtectionReady={reservationProtectionReady}
            onStartLane={startDartLane}
            onOverrideLane={overrideDartLane}
            onEndLane={endDartLane}
          />
          <div className="mt-5">
            <EntertainmentReservations activity="darts" reservations={entertainmentReservations} />
          </div>
        </>
      )}

      {(staffTab === "pool" || staffTab === "shuffleboard") && (
        <>
          <TimedResourcePlanner
            key={staffTab}
            resourceType={staffTab}
            sessions={resourceSessions}
            reservations={entertainmentReservations}
            nowMs={nowMs}
            busyKey={resourceBusyKey}
            onAdd={addResourceSession}
            onClear={clearResourceSession}
          />
          <div className="mt-5">
            <EntertainmentReservations activity={staffTab} reservations={entertainmentReservations} />
          </div>
        </>
      )}

      {staffTab === "queue" && (
        <>
      <section className="mb-8 rounded-2xl border border-sky-400/30 bg-gradient-to-br from-sky-950/50 to-[#141414] p-5 shadow-lg shadow-sky-950/20">
        <h2 className="text-base font-bold text-sky-100">Add guest to waitlist</h2>
        <p className="mt-1 text-xs text-sky-200/60">Staff entry · confirm SMS consent with the guest</p>
        <form onSubmit={addGuest} className="mt-4 space-y-3">
          <select
            value={addActivity}
            onChange={(e) => {
              const activity = e.target.value as Activity;
              setAddActivity(activity);
              setAddLaneCount((prev) =>
                normalizeLaneCount(activity, prev) as LaneCount,
              );
              setAddSessionMinutes(defaultSessionMinutesFor(activity));
            }}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
          >
            {ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              required
              placeholder="First name"
              value={addFirstName}
              onChange={(e) => setAddFirstName(e.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
            />
            <input
              type="text"
              required
              placeholder="Last name"
              value={addLastName}
              onChange={(e) => setAddLastName(e.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
            />
          </div>
          <input
            type="tel"
            required
            placeholder="Mobile number"
            value={addPhone}
            onChange={(e) => setAddPhone(e.target.value)}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white"
          />
          <BookingOptions
            activity={addActivity}
            laneCount={addLaneCount}
            sessionMinutes={addSessionMinutes}
            onLaneCountChange={setAddLaneCount}
            onSessionMinutesChange={setAddSessionMinutes}
            compact
          />
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={addSms}
              onChange={(e) => setAddSms(e.target.checked)}
              className="rounded"
            />
            SMS opt-in
          </label>
          <button
            type="submit"
            disabled={addLoading}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-neutral-900 disabled:opacity-60"
          >
            {addLoading ? "Adding…" : "Add guest"}
          </button>
          {addStatus && (
            <p className="text-xs text-neutral-400">{addStatus}</p>
          )}
        </form>
      </section>

      <div className="space-y-8">
        {ACTIVITIES.map((activity) => {
          const block = queues.find((q) => q.activity === activity);
          const active =
            block?.queue.filter(
              (e) => e.status === "waiting" || e.status === "notified",
            ) ?? [];
          const theme = ACTIVITY_THEME[activity];
          const timedActivity =
            activity === "pool" || activity === "shuffleboard";
          const activeResourceSessions = timedActivity
            ? resourceSessions
                .filter((session) => session.resourceType === activity)
                .sort(
                  (a, b) =>
                    new Date(a.endsAt).getTime() -
                    new Date(b.endsAt).getTime(),
                )
            : [];
          const nextResource = activeResourceSessions[0];

          return (
            <section
              key={activity}
              className="rounded-2xl border bg-[#101010] p-4"
              style={{ borderColor: `${theme.accent}55` }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold text-white">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: theme.accent }}
                  >
                    <ActivityIcon activity={activity} className="h-5 w-5" />
                  </span>
                  {ACTIVITY_LABELS[activity]}
                </h2>
                <span
                  className="rounded-full px-3 py-1 text-xs font-bold text-white"
                  style={{ backgroundColor: `${theme.accent}BB` }}
                >
                  {active.length} waiting
                </span>
              </div>

              {active.length === 0 && activeResourceSessions.length === 0 ? (
                <p className="text-sm text-neutral-500">No one waiting</p>
              ) : active.length > 0 ? (
                <ul className="space-y-2">
                  {active.map((entry, i) => {
                    const isSelected = selectedId === entry.id;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedId(isSelected ? null : entry.id)
                          }
                          className={`w-full rounded-2xl border p-4 text-left transition ${
                            isSelected
                              ? "border-white/50 bg-neutral-800 ring-2 ring-white/10"
                              : entry.status === "notified"
                                ? "border-amber-400/60 bg-amber-950/30 shadow-md shadow-amber-950/20"
                                : "border-white/10 bg-[#181818] hover:border-white/30"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                                style={{ backgroundColor: theme.accent }}
                              >
                                {i + 1}
                              </span>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium text-white">
                                    {entry.name}
                                  </p>
                                  {entry.status === "notified" && (
                                    <span className="rounded-md bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-amber-200">
                                      Notified {notificationElapsed(entry.notifiedAt, nowMs)} ago
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-neutral-500">
                                  {formatBookingSummary(
                                    activity,
                                    entry.laneCount,
                                    entry.sessionMinutes,
                                  )}{" "}
                                  · {entry.phone}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              {entry.smsOptIn && smsStatusLabel(
                                entry.status === "notified" ? entry.lastSmsStatus : entry.joinSmsStatus,
                                entry.status === "notified" ? entry.lastSmsErrorCode : entry.joinSmsErrorCode,
                              ) && (
                                <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${smsStatusClass(entry.status === "notified" ? entry.lastSmsStatus : entry.joinSmsStatus)}`}>
                                  {entry.status === "notified" ? "Ready text: " : "Join text: "}
                                  {smsStatusLabel(
                                    entry.status === "notified" ? entry.lastSmsStatus : entry.joinSmsStatus,
                                    entry.status === "notified" ? entry.lastSmsErrorCode : entry.joinSmsErrorCode,
                                  )}
                                </span>
                              )}
                              {entry.status === "notified" && (
                                <span className="rounded bg-amber-400 px-2 py-0.5 text-[10px] font-black text-amber-950">
                                  Notified {Math.max(1, entry.notificationCount ?? 0)}×
                                </span>
                              )}
                            </div>
                          </div>

                          {isSelected && (
                            <div
                              className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {editId === entry.id ? (
                                <form
                                  onSubmit={(event) => void saveGuestEdit(event, entry)}
                                  className="grid w-full gap-2 rounded-xl border border-white/10 bg-neutral-950 p-3 sm:grid-cols-3"
                                >
                                  <label className="text-xs font-medium text-neutral-400">
                                    Phone number
                                    <input
                                      required
                                      value={editPhone}
                                      onChange={(event) => setEditPhone(event.target.value)}
                                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                                    />
                                  </label>
                                  <label className="text-xs font-medium text-neutral-400">
                                    Lanes / tables
                                    <select
                                      value={editLaneCount}
                                      onChange={(event) => setEditLaneCount(Number(event.target.value) as LaneCount)}
                                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                                    >
                                      {laneCountOptions(entry.activity).map((count) => (
                                        <option key={count} value={count}>{count}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs font-medium text-neutral-400">
                                    Session time
                                    <select
                                      value={editSessionMinutes}
                                      onChange={(event) => setEditSessionMinutes(Number(event.target.value) as SessionDuration)}
                                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
                                    >
                                      {sessionOptionsFor(entry.activity).map((minutes) => (
                                        <option key={minutes} value={minutes}>{minutes} minutes</option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="flex gap-2 sm:col-span-3">
                                    <button
                                      type="submit"
                                      disabled={editSaving}
                                      className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-60"
                                    >
                                      {editSaving ? "Saving…" : "Save changes & send update"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditId(null)}
                                      className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => beginEdit(entry)}
                                  className="w-full rounded-xl border border-sky-500/40 px-4 py-2 text-sm font-semibold text-sky-200 hover:bg-sky-500/10"
                                >
                                  Edit phone, lanes, or session time
                                </button>
                              )}
                              {entry.status === "waiting" && (
                                <button
                                  type="button"
                                  disabled={actionId === entry.id}
                                  onClick={() =>
                                    staffAction("/api/staff/notify", entry.id)
                                  }
                                  className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                                >
                                  {actionId === entry.id
                                    ? "Sending…"
                                    : entry.smsOptIn
                                      ? "Notify — send SMS"
                                      : "Notify — mark called"}
                                </button>
                              )}
                              {entry.status === "notified" && (
                                <button
                                  type="button"
                                  disabled={actionId === entry.id}
                                  onClick={() =>
                                    staffAction("/api/staff/recall", entry.id)
                                  }
                                  className="flex-1 rounded-xl border border-amber-500/40 px-4 py-3 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-60"
                                >
                                  {actionId === entry.id
                                    ? "Recalling…"
                                    : "Recall — resend text"}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={actionId === entry.id}
                                onClick={() =>
                                  staffAction("/api/staff/serve", entry.id)
                                }
                                className="rounded-xl border border-neutral-600 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800"
                              >
                                Served
                              </button>
                              <button
                                type="button"
                                disabled={actionId === entry.id}
                                onClick={() =>
                                  staffAction("/api/staff/remove", entry.id)
                                }
                                className="rounded-xl px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {activeResourceSessions.length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-neutral-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {activeResourceSessions.length} in play
                      {active.length > 0
                        ? ` · ${active.length} waitlisted`
                        : " · no waitlisted parties"}
                    </p>
                    <p className="text-sm font-semibold text-emerald-300">
                      {new Date(nextResource.endsAt).getTime() <= nowMs
                        ? "Next table awaiting pickup"
                        : `Next available in ${sessionCountdown(nextResource.endsAt, nowMs)}`}
                    </p>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {activeResourceSessions.map((session) => {
                      const resource = TIMED_RESOURCES[session.resourceType].find(
                        (item) => item.id === session.resourceId,
                      );
                      const ended = new Date(session.endsAt).getTime() <= nowMs;
                      return (
                        <li
                          key={`${session.resourceType}:${session.resourceId}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#141414] px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">
                              {resource?.label}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {session.guestName}
                            </p>
                          </div>
                          <p
                            className={`font-mono text-sm font-semibold ${
                              ended ? "text-red-300" : "text-neutral-200"
                            }`}
                          >
                            {ended
                              ? "Collect equipment"
                              : sessionCountdown(session.endsAt, nowMs)}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="mt-10 border-t border-white/10 pt-6">
        <button
          type="button"
          onClick={() => setServedOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h2 className="text-base font-semibold text-white">
              Served / removed
            </h2>
            <p className="text-xs text-neutral-500">
              Tap a name to recall or delete to archive ({servedRemoved.length})
            </p>
          </div>
          <span className="text-sm text-neutral-400">
            {servedOpen ? "Hide" : "Show"}
          </span>
        </button>

        {servedOpen && (
          <div className="mt-4">
            {servedRemoved.length === 0 ? (
              <p className="text-sm text-neutral-500">None yet</p>
            ) : (
              <ul className="space-y-2">
                {servedRemoved.map((entry) => {
                  const isSelected = selectedId === entry.id;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedId(isSelected ? null : entry.id)
                        }
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          isSelected
                            ? "border-white/30 bg-neutral-900"
                            : "border-dashed border-white/10 bg-neutral-900/50 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-neutral-200">
                              {entry.name}
                            </p>
                            <p className="text-xs text-neutral-500">
                              {ACTIVITY_LABELS[entry.activity]} ·{" "}
                              {entry.status === "served"
                                ? "Served"
                                : "Removed"}{" "}
                              · {entry.phone}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <div
                            className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={actionId === entry.id}
                              onClick={() =>
                                staffAction("/api/staff/recall", entry.id)
                              }
                              className="flex-1 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
                            >
                              {actionId === entry.id
                                ? "…"
                                : "Recall to queue"}
                            </button>
                            <button
                              type="button"
                              disabled={actionId === entry.id}
                              onClick={() =>
                                staffAction("/api/staff/archive", entry.id)
                              }
                              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                            >
                              {actionId === entry.id
                                ? "…"
                                : "Delete — hide in archive"}
                            </button>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="mt-8 border-t border-white/10 pt-6 pb-8">
        <button
          type="button"
          onClick={() => setArchiveOpen((o) => !o)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h2 className="text-base font-semibold text-neutral-300">
              Hidden archive
            </h2>
            <p className="text-xs text-neutral-500">
              Search deleted parties by name · loaded only when opened
            </p>
          </div>
          <span className="text-sm text-neutral-400">
            {archiveOpen ? "Hide" : "Show"}
          </span>
        </button>

        {archiveOpen && (
          <div className="mt-4 space-y-3">
            <input
              type="search"
              value={archiveQuery}
              onChange={(e) => setArchiveQuery(e.target.value)}
              placeholder="Search party name…"
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-white placeholder:text-neutral-500"
            />
            {archiveError && (
              <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {archiveError}
                <button
                  type="button"
                  onClick={() =>
                    void loadArchive(secret, archiveQuery, 1)
                  }
                  className="ml-2 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}
            {archiveLoading && archiveEntries.length === 0 ? (
              <p className="text-sm text-neutral-500">Loading archive…</p>
            ) : archiveEntries.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {archiveQuery.trim()
                  ? "No matching parties"
                  : "Archive is empty"}
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {archiveEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-2xl border border-white/5 bg-neutral-950/80 p-4"
                    >
                      <p className="font-medium text-neutral-400">{entry.name}</p>
                      <p className="text-xs text-neutral-600">
                        {ACTIVITY_LABELS[entry.activity]} · {entry.phone}
                      </p>
                    </li>
                  ))}
                </ul>
                {archiveHasMore && (
                  <button
                    type="button"
                    disabled={archiveLoading}
                    onClick={() =>
                      void loadArchive(
                        secret,
                        archiveQuery,
                        archivePage + 1,
                        true,
                      )
                    }
                    className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-neutral-300 hover:bg-white/5 disabled:opacity-60"
                  >
                    {archiveLoading ? "Loading…" : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {selectedEntry &&
        (selectedEntry.status === "waiting" ||
          selectedEntry.status === "notified") && (
        <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0a0a0a]/95 p-4 backdrop-blur-xl sm:hidden">
          <p className="mb-2 text-center text-sm font-medium text-white">
            {selectedEntry.name}
          </p>
          {selectedEntry.status === "waiting" && (
            <button
              type="button"
              disabled={actionId === selectedEntry.id}
              onClick={() =>
                staffAction("/api/staff/notify", selectedEntry.id)
              }
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white"
            >
              Notify guest
            </button>
          )}
          {selectedEntry.status === "notified" && (
            <button
              type="button"
              disabled={actionId === selectedEntry.id}
              onClick={() =>
                staffAction("/api/staff/recall", selectedEntry.id)
              }
              className="mt-2 w-full rounded-xl border border-amber-500/40 py-3 text-sm font-semibold text-amber-200"
            >
              Recall — resend text
            </button>
          )}
        </div>
      )}
        </>
      )}
    </main>
  );
}
