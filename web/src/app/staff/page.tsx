"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIcon } from "@/components/ActivityIcon";
import { BookingOptions } from "@/components/BookingOptions";
import { BowlingPlanner } from "@/components/BowlingPlanner";
import { DartsPlanner } from "@/components/DartsPlanner";
import { TimedResourcePlanner } from "@/components/TimedResourcePlanner";
import { EntertainmentReservations } from "@/components/EntertainmentReservations";
import type { EntertainmentReservation } from "@/lib/entertainment-schedule";
import {
  defaultSessionMinutesFor,
  formatBookingSummary,
  normalizeLaneCount,
} from "@/lib/booking";
import type { BowlingLaneSnapshot } from "@/lib/bowling-lanes";
import type { DartseeLaneSnapshot } from "@/lib/dartsee-lanes";
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
const STAFF_SECRET_STORAGE_KEY = "onpar-staff-secret";
const BOWLING_STALE_AFTER_MS = 2 * 60_000;
type StaffTab = "queue" | "bowling" | "darts" | "pool" | "shuffleboard";

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [staffTab, setStaffTab] = useState<StaffTab>("queue");

  const knownIdsRef = useRef<Set<string> | null>(null);
  const chimeRef = useRef<HTMLAudioElement | null>(null);

  const [addActivity, setAddActivity] = useState<Activity>("bowling");
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName, setAddLastName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addSms, setAddSms] = useState(false);
  const [addRewards, setAddRewards] = useState(false);
  const [addLaneCount, setAddLaneCount] = useState<LaneCount>(1);
  const [addSessionMinutes, setAddSessionMinutes] =
    useState<SessionDuration>(defaultSessionMinutesFor("bowling"));
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [servedOpen, setServedOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-staff-secret": secret,
    }),
    [secret],
  );

  const fetchQueues = useCallback(async (showLoading = true) => {
    if (!secret) return;
    await Promise.resolve();
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/staff/queue", { headers: headers() });
      if (res.status === 401) {
        setAuthenticated(false);
        sessionStorage.removeItem(STAFF_SECRET_STORAGE_KEY);
        return;
      }
      const data = await res.json();
      setQueues(data.queues ?? []);
      const [laneRes, dartLaneRes, resourceRes, scheduleRes] = await Promise.all([
        fetch("/api/staff/bowling-lanes", { headers: headers() }),
        fetch("/api/staff/dart-lanes", { headers: headers() }),
        fetch("/api/staff/resource-sessions", { headers: headers() }),
        fetch("/api/staff/entertainment-schedule", { headers: headers() }),
      ]);
      if (laneRes.ok) {
        const laneData = await laneRes.json();
        setBowlingSnapshot(laneData.snapshot ?? null);
      }
      if (dartLaneRes.ok) {
        const dartLaneData = await dartLaneRes.json();
        setDartseeSnapshot(dartLaneData.snapshot ?? null);
      }
      if (resourceRes.ok) {
        const resourceData = await resourceRes.json();
        setResourceSessions(resourceData.sessions ?? []);
      }
      if (scheduleRes.ok) {
        const scheduleData = await scheduleRes.json();
        setEntertainmentReservations(scheduleData.schedule?.reservations ?? []);
      }
      setAuthenticated(true);
      sessionStorage.setItem(STAFF_SECRET_STORAGE_KEY, secret);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [secret, headers]);

  useEffect(() => {
    const soundTimeout = window.setTimeout(() => {
      setSoundOn(sessionStorage.getItem(SOUND_STORAGE_KEY) === "1");
    }, 0);
    const audio = new Audio("/sounds/new-guest.wav");
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
      void (async () => {
        const res = await fetch("/api/staff/queue", {
          headers: {
            "Content-Type": "application/json",
            "x-staff-secret": saved,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setQueues(data.queues ?? []);
          const savedHeaders = {
            "Content-Type": "application/json",
            "x-staff-secret": saved,
          };
          const [laneRes, dartLaneRes, resourceRes, scheduleRes] = await Promise.all([
            fetch("/api/staff/bowling-lanes", {
              headers: savedHeaders,
            }),
            fetch("/api/staff/dart-lanes", {
              headers: savedHeaders,
            }),
            fetch("/api/staff/resource-sessions", {
              headers: savedHeaders,
            }),
            fetch("/api/staff/entertainment-schedule", {
              headers: savedHeaders,
            }),
          ]);
          if (laneRes.ok) {
            const laneData = await laneRes.json();
            setBowlingSnapshot(laneData.snapshot ?? null);
          }
          if (dartLaneRes.ok) {
            const dartLaneData = await dartLaneRes.json();
            setDartseeSnapshot(dartLaneData.snapshot ?? null);
          }
          if (resourceRes.ok) {
            const resourceData = await resourceRes.json();
            setResourceSessions(resourceData.sessions ?? []);
          }
          if (scheduleRes.ok) {
            const scheduleData = await scheduleRes.json();
            setEntertainmentReservations(scheduleData.schedule?.reservations ?? []);
          }
          setAuthenticated(true);
        } else {
          sessionStorage.removeItem(STAFF_SECRET_STORAGE_KEY);
        }
      })();
    }, 0);

    return () => window.clearTimeout(authTimeout);
  }, []);

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
    let hasNew = false;
    for (const id of nextIds) {
      if (!knownIdsRef.current.has(id)) {
        hasNew = true;
        break;
      }
    }
    knownIdsRef.current = nextIds;
    if (!hasNew || !soundOn) return;
    const audio = chimeRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      console.warn("[staff] chime blocked or failed", err);
    });
  }, [queues, authenticated, soundOn]);

  function toggleSound() {
    setSoundOn((prev) => {
      const next = !prev;
      sessionStorage.setItem(SOUND_STORAGE_KEY, next ? "1" : "0");
      if (next) {
        const audio = chimeRef.current;
        if (audio) {
          audio.currentTime = 0;
          void audio.play().catch((err) => {
            console.warn("[staff] chime preview blocked", err);
          });
        }
      }
      return next;
    });
  }

  async function staffAction(endpoint: string, id: string) {
    setActionId(id);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? "Action failed");
        return;
      }
      await fetchQueues();
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
          rewardsOptIn: addRewards,
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
        `Added ${addFirstName} ${addLastName} to ${ACTIVITY_LABELS[addActivity]}`,
      );
      setAddFirstName("");
      setAddLastName("");
      setAddPhone("");
      setAddSms(false);
      setAddRewards(false);
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
    durationMinutes: 60 | 120;
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
  const archivedEntries = allEntries
    .filter((e) => e.status === "archived")
    .filter((e) => {
      const q = archiveQuery.trim().toLowerCase();
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
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
    Boolean(bowlingSnapshot) &&
    (bowlingSnapshot?.healthStatus !== "ok" || bowlingFeedStale);
  const dartseeFeedNeedsAttention =
    Boolean(dartseeSnapshot) && dartseeSnapshot?.healthStatus !== "ok";

  if (!authenticated) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <h1 className="text-2xl font-semibold text-white">Staff</h1>
        <p className="mt-2 text-sm text-neutral-400">Enter your staff password.</p>
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
          className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-semibold text-neutral-900"
        >
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-24 sm:px-5">
      {bowlingSnapshot && bowlingFeedNeedsAttention && (
        <button
          type="button"
          onClick={() => setStaffTab("bowling")}
          className="mb-5 w-full rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Brunswick feed needs attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            {bowlingSnapshot.healthStatus !== "ok"
              ? (bowlingSnapshot.healthMessage ??
                "Lane times may be stale. Check the Brunswick computer and Remote Desktop window.")
              : "No Brunswick snapshot has arrived for over 2 minutes. Confirm the watcher is running and check the Brunswick Remote Desktop window."}
          </span>
        </button>
      )}
      {dartseeSnapshot && dartseeFeedNeedsAttention && (
        <button
          type="button"
          onClick={() => setStaffTab("darts")}
          className="mb-5 w-full rounded-xl border border-red-400 bg-red-700 px-4 py-3 text-left text-sm font-semibold text-white shadow-lg shadow-red-950/30"
          role="alert"
        >
          <span className="block">Dartsee feed needs attention</span>
          <span className="mt-1 block text-xs font-normal text-red-100">
            {dartseeSnapshot.healthMessage ??
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
            onClick={toggleSound}
            aria-pressed={soundOn}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
            title={
              soundOn
                ? "Mute new-guest chime"
                : "Enable chime when someone joins"
            }
          >
            {soundOn ? "Sound on" : "Sound off"}
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
          <DartsPlanner snapshot={dartseeSnapshot} entries={allEntries} reservations={entertainmentReservations} />
          <div className="mt-5">
            <EntertainmentReservations activity="darts" reservations={entertainmentReservations} />
          </div>
        </>
      )}

      {(staffTab === "pool" || staffTab === "shuffleboard") && (
        <>
          <TimedResourcePlanner
            resourceType={staffTab}
            sessions={resourceSessions}
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
      <section className="mb-8 rounded-2xl border border-white/10 bg-[#141414] p-5">
        <h2 className="text-sm font-semibold text-white">Add to waitlist</h2>
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
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={addRewards}
              onChange={(e) => setAddRewards(e.target.checked)}
              className="rounded"
            />
            Rewards program
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
            <section key={activity}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
                <ActivityIcon activity={activity} className="h-5 w-5" />
                {ACTIVITY_LABELS[activity]}
                <span className="text-sm font-normal text-neutral-500">
                  ({active.length})
                </span>
              </h2>

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
                              ? "border-white/30 bg-neutral-900"
                              : "border-white/10 bg-[#141414] hover:border-white/20"
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
                                <p className="font-medium text-white">
                                  {entry.name}
                                </p>
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
                              {entry.smsOptIn && (
                                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                  SMS
                                </span>
                              )}
                              {entry.status === "notified" && (
                                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                  Called
                                </span>
                              )}
                            </div>
                          </div>

                          {isSelected && (
                            <div
                              className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4"
                              onClick={(e) => e.stopPropagation()}
                            >
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
              Search deleted parties by name (
              {
                allEntries.filter((e) => e.status === "archived").length
              }
              )
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
            {archivedEntries.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {archiveQuery.trim()
                  ? "No matching parties"
                  : "Archive is empty"}
              </p>
            ) : (
              <ul className="space-y-2">
                {archivedEntries.map((entry) => (
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
