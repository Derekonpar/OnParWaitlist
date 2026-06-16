"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityIcon } from "@/components/ActivityIcon";
import { BookingOptions } from "@/components/BookingOptions";
import {
  formatBookingSummary,
  normalizeLaneCount,
  normalizeSessionMinutes,
} from "@/lib/booking";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  ACTIVITY_THEME,
  type Activity,
  type LaneCount,
  type SessionDuration,
  type WaitlistEntry,
} from "@/lib/types";

export default function StaffPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [queues, setQueues] = useState<
    { activity: Activity; queue: WaitlistEntry[] }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [addActivity, setAddActivity] = useState<Activity>("bowling");
  const [addFirstName, setAddFirstName] = useState("");
  const [addLastName, setAddLastName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addSms, setAddSms] = useState(false);
  const [addRewards, setAddRewards] = useState(false);
  const [addLaneCount, setAddLaneCount] = useState<LaneCount>(1);
  const [addSessionMinutes, setAddSessionMinutes] =
    useState<SessionDuration>(30);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  const headers = useCallback(
    () => ({
      "Content-Type": "application/json",
      "x-staff-secret": secret,
    }),
    [secret],
  );

  const fetchQueues = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const res = await fetch("/api/staff/queue", { headers: headers() });
      if (res.status === 401) {
        setAuthenticated(false);
        sessionStorage.removeItem("onpar-staff-secret");
        return;
      }
      const data = await res.json();
      setQueues(data.queues ?? []);
      setAuthenticated(true);
      sessionStorage.setItem("onpar-staff-secret", secret);
    } finally {
      setLoading(false);
    }
  }, [secret, headers]);

  useEffect(() => {
    const saved = sessionStorage.getItem("onpar-staff-secret");
    if (!saved) return;
    setSecret(saved);
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/staff/queue", {
          headers: {
            "Content-Type": "application/json",
            "x-staff-secret": saved,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setQueues(data.queues ?? []);
          setAuthenticated(true);
        } else {
          sessionStorage.removeItem("onpar-staff-secret");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchQueues();
    const interval = setInterval(fetchQueues, 6000);
    return () => clearInterval(interval);
  }, [authenticated, fetchQueues]);

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
      if (endpoint.includes("notify") || endpoint.includes("recall")) {
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
      setAddSessionMinutes(30);
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
          onClick={fetchQueues}
          className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-semibold text-neutral-900"
        >
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-6 pb-24 sm:px-5">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Staff console</h1>
          <p className="text-xs text-neutral-500">Tap a guest to manage their spot</p>
        </div>
        <button
          type="button"
          onClick={fetchQueues}
          disabled={loading}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

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
              setAddSessionMinutes((prev) =>
                normalizeSessionMinutes(activity, prev) as SessionDuration,
              );
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
          const recallable =
            block?.queue.filter(
              (e) => e.status === "served" || e.status === "cancelled",
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

              {recallable.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    Accidental serve / remove
                  </p>
                  <ul className="space-y-2">
                    {recallable.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between rounded-2xl border border-dashed border-white/10 bg-neutral-900/50 p-4"
                      >
                        <div>
                          <p className="font-medium text-neutral-300">
                            {entry.name}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {entry.status === "served" ? "Marked served" : "Removed"}{" "}
                            · {entry.phone}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={actionId === entry.id}
                          onClick={() =>
                            staffAction("/api/staff/recall", entry.id)
                          }
                          className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
                        >
                          {actionId === entry.id ? "…" : "Recall to queue"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {selectedEntry && (
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
    </main>
  );
}
