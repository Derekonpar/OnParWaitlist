"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIcon } from "@/components/ActivityIcon";
import { BookingOptions } from "@/components/BookingOptions";
import { BowlingPlanner } from "@/components/BowlingPlanner";
import {
  defaultSessionMinutesFor,
  formatBookingSummary,
  normalizeLaneCount,
} from "@/lib/booking";
import type { BowlingLaneSnapshot } from "@/lib/bowling-lanes";
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
type StaffTab = "queue" | "bowling";

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

export default function StaffPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [queues, setQueues] = useState<
    { activity: Activity; queue: WaitlistEntry[] }[]
  >([]);
  const [bowlingSnapshot, setBowlingSnapshot] =
    useState<BowlingLaneSnapshot | null>(null);
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
      const laneRes = await fetch("/api/staff/bowling-lanes", {
        headers: headers(),
      });
      if (laneRes.ok) {
        const laneData = await laneRes.json();
        setBowlingSnapshot(laneData.snapshot ?? null);
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
          const laneRes = await fetch("/api/staff/bowling-lanes", {
            headers: {
              "Content-Type": "application/json",
              "x-staff-secret": saved,
            },
          });
          if (laneRes.ok) {
            const laneData = await laneRes.json();
            setBowlingSnapshot(laneData.snapshot ?? null);
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
    }, 6000);
    return () => clearInterval(interval);
  }, [authenticated, fetchQueues]);

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

      <div className="mb-6 grid grid-cols-2 rounded-xl border border-white/10 bg-neutral-950 p-1">
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
      </div>

      {staffTab === "bowling" && (
        <BowlingPlanner snapshot={bowlingSnapshot} entries={allEntries} />
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

          return (
            <section key={activity}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
                <ActivityIcon activity={activity} className="h-5 w-5" />
                {ACTIVITY_LABELS[activity]}
                <span className="text-sm font-normal text-neutral-500">
                  ({active.length})
                </span>
              </h2>

              {active.length === 0 ? (
                <p className="text-sm text-neutral-500">No one waiting</p>
              ) : (
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
