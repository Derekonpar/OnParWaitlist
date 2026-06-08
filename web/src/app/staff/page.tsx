"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { ActivityIcon } from "@/components/ActivityIcon";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  type Activity,
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
  const [testPhone, setTestPhone] = useState("");
  const [testSmsStatus, setTestSmsStatus] = useState<string | null>(null);
  const [testSmsLoading, setTestSmsLoading] = useState(false);
  const [storageHint, setStorageHint] = useState<string | null>(null);

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
        return;
      }
      const data = await res.json();
      setQueues(data.queues ?? []);
      setAuthenticated(true);

      const storageRes = await fetch("/api/staff/storage", { headers: headers() });
      if (storageRes.ok) {
        const storage = await storageRes.json();
        setStorageHint(storage.canWrite ? null : (storage.hint ?? "Storage not ready"));
      }
    } finally {
      setLoading(false);
    }
  }, [secret, headers]);

  useEffect(() => {
    if (!authenticated) return;
    fetchQueues();
    const interval = setInterval(fetchQueues, 8000);
    return () => clearInterval(interval);
  }, [authenticated, fetchQueues]);

  async function sendTestSms() {
    setTestSmsLoading(true);
    setTestSmsStatus(null);
    try {
      const res = await fetch("/api/staff/test-sms", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json();
      setTestSmsStatus(
        res.ok ? data.message : (data.error ?? "Test SMS failed"),
      );
    } catch {
      setTestSmsStatus("Network error");
    } finally {
      setTestSmsLoading(false);
    }
  }

  async function staffAction(
    endpoint: string,
    id: string,
  ) {
    setActionId(id);
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id }),
      });
      await fetchQueues();
    } finally {
      setActionId(null);
    }
  }

  if (!authenticated) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-md px-5 py-12">
          <h1 className="text-xl font-semibold text-neutral-900">
            Staff sign in
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Enter the staff secret from your environment variables.
          </p>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Staff secret"
            className="mt-6 w-full rounded-xl border border-neutral-200 px-4 py-3"
          />
          <button
            type="button"
            onClick={fetchQueues}
            className="mt-4 w-full rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white"
          >
            Continue
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-5 py-8">
        {storageHint && (
          <section className="mb-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
            <h2 className="text-sm font-semibold text-red-200">Waitlist storage issue</h2>
            <p className="mt-1 text-xs text-red-100/90">{storageHint}</p>
            <p className="mt-2 text-xs text-neutral-400">
              Vercel → Storage → Marketplace → Upstash Redis → connect to this project → Redeploy.
            </p>
          </section>
        )}

        <section className="mb-8 rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4">
          <h2 className="text-sm font-semibold text-white">Test Twilio SMS</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Send a one-time test text to verify Twilio is connected.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="tel"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Your mobile number"
              className="flex-1 rounded-xl border border-neutral-600 bg-neutral-900 px-4 py-2.5 text-sm text-white"
            />
            <button
              type="button"
              onClick={sendTestSms}
              disabled={testSmsLoading || !testPhone}
              className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {testSmsLoading ? "Sending…" : "Send test"}
            </button>
          </div>
          {testSmsStatus && (
            <p className="mt-2 text-xs text-neutral-300">{testSmsStatus}</p>
          )}
        </section>

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">Manage queues</h1>
          <button
            type="button"
            onClick={fetchQueues}
            disabled={loading}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="space-y-8">
          {ACTIVITIES.map((activity) => {
            const block = queues.find((q) => q.activity === activity);
            const waiting =
              block?.queue.filter((e) => e.status === "waiting") ?? [];
            const notified =
              block?.queue.filter((e) => e.status === "notified") ?? [];

            return (
              <section key={activity}>
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <ActivityIcon activity={activity} className="h-5 w-5 text-white" />
                  {ACTIVITY_LABELS[activity]}
                  <span className="text-sm font-normal text-neutral-400">
                    ({waiting.length} waiting)
                  </span>
                </h2>

                {waiting.length === 0 && notified.length === 0 ? (
                  <p className="text-sm text-neutral-400">Queue empty</p>
                ) : (
                  <ul className="space-y-2">
                    {[...waiting, ...notified].map((entry, i) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4"
                      >
                        <div>
                          <span className="mr-2 text-xs font-medium text-neutral-400">
                            #{i + 1}
                          </span>
                          <span className="font-medium">{entry.name}</span>
                          <span className="ml-2 text-xs text-neutral-400">
                            {entry.phone}
                          </span>
                          {entry.smsOptIn && (
                            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              SMS
                            </span>
                          )}
                          {entry.status === "notified" && (
                            <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              Notified
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {entry.status === "waiting" && (
                            <button
                              type="button"
                              disabled={actionId === entry.id}
                              onClick={() =>
                                staffAction("/api/staff/notify", entry.id)
                              }
                              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Notify
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={actionId === entry.id}
                            onClick={() =>
                              staffAction("/api/staff/serve", entry.id)
                            }
                            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium"
                          >
                            Served
                          </button>
                          <button
                            type="button"
                            disabled={actionId === entry.id}
                            onClick={() =>
                              staffAction("/api/staff/remove", entry.id)
                            }
                            className="rounded-lg px-3 py-1.5 text-xs text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
