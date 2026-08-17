"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { formatBookingSummary } from "@/lib/booking";
import { Header } from "@/components/Header";
import type { Activity } from "@/lib/types";

interface StatusData {
  entry: {
    id: string;
    name: string;
    activity: string;
    activityLabel: string;
    status: string;
    laneCount?: number;
    sessionMinutes?: number;
  };
  position: number;
  estimatedWaitMinutes: number;
  availabilityStatus: "live" | "unknown";
}

export default function StatusPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const smsFailed = searchParams.get("sms") === "failed";
  const [data, setData] = useState<StatusData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshSequenceRef = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (refreshControllerRef.current) return;

    const sequence = ++refreshSequenceRef.current;
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 7_000);
    try {
      const res = await fetch(`/api/waitlist/status/${id}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (sequence !== refreshSequenceRef.current) return;
      if (res.status === 404) {
        setData(null);
        setNotFound(true);
        setRefreshError(false);
        return;
      }
      if (!res.ok) throw new Error("refresh failed");

      const nextData = await res.json();
      if (sequence !== refreshSequenceRef.current) return;
      setData(nextData);
      setNotFound(false);
      setRefreshError(false);
    } catch {
      if (sequence === refreshSequenceRef.current) {
        setRefreshError(true);
      }
    } finally {
      window.clearTimeout(timeout);
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }
    }
  }, [id]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      refreshSequenceRef.current += 1;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
    };
  }, [load]);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-5 py-12 text-center">
        {notFound && (
          <div>
            <p className="text-neutral-400">Waitlist entry not found.</p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-medium text-white underline"
            >
              Back to waitlists
            </Link>
          </div>
        )}

        {!notFound && !data && (
          <div>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
            {refreshError && (
              <p className="mt-4 text-sm text-amber-200">
                Live status is taking longer than expected. Retrying…
              </p>
            )}
          </div>
        )}

        {data && (
          <div className="w-full">
            {refreshError && (
              <p className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Live status is updating — showing your last known place.
              </p>
            )}
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-2xl text-emerald-300">
              ✓
            </div>
            <h1 className="text-2xl font-semibold text-white">
              You&apos;re on the list, {data.entry.name.split(" ")[0]}!
            </h1>
            <p className="mt-2 text-neutral-400">
              {data.entry.activityLabel}
              {data.entry.laneCount != null && data.entry.activity && (
                <>
                  {" "}
                  ·{" "}
                  {formatBookingSummary(
                    data.entry.activity as Activity,
                    data.entry.laneCount,
                    data.entry.sessionMinutes ?? 30,
                  )}
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Your name is shown on the public waitlist and TV display.
            </p>

            {smsFailed && (
              <p className="mt-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
                You&apos;re on the list, but we couldn&apos;t send a
                confirmation text. Watch the public TV waitlist or this screen
                for your turn.
              </p>
            )}

            {data.entry.status === "waiting" ? (
              <div className="mt-10 rounded-3xl border border-white/10 bg-[#141414] p-8">
                <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
                  Your position
                </p>
                <p className="mt-2 text-6xl font-semibold tabular-nums text-white">
                  #{data.position}
                </p>
                <p className="mt-4 text-neutral-400">
                  {data.availabilityStatus === "live"
                    ? `Estimated wait ~${data.estimatedWaitMinutes} min`
                    : "Live lane timing is updating. Your position is current."}
                </p>
              </div>
            ) : data.entry.status === "notified" ? (
              <div className="mt-10 rounded-3xl border border-emerald-500/40 bg-emerald-500/15 p-8">
                <p className="text-lg font-semibold text-emerald-200">
                  You&apos;re up!
                </p>
                <p className="mt-2 text-emerald-300/90">
                  Please check in at the front desk within 5 minutes.
                </p>
              </div>
            ) : (
              <p className="mt-8 text-neutral-500">This visit is complete.</p>
            )}

            <Link
              href="/"
              className="mt-8 inline-block text-sm font-medium text-neutral-400 hover:text-white"
            >
              ← All waitlists
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
