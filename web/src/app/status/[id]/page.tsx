"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Header } from "@/components/Header";

interface StatusData {
  entry: {
    id: string;
    name: string;
    activityLabel: string;
    status: string;
    laneCount?: number;
    sessionMinutes?: number;
  };
  position: number;
  estimatedWaitMinutes: number;
}

export default function StatusPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/waitlist/status/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      setData(await res.json());
      setError(false);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-5 py-12 text-center">
        {error && (
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

        {!error && !data && (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
        )}

        {data && (
          <div className="w-full">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-2xl text-emerald-300">
              ✓
            </div>
            <h1 className="text-2xl font-semibold text-white">
              You&apos;re on the list, {data.entry.name.split(" ")[0]}!
            </h1>
            <p className="mt-2 text-neutral-400">
              {data.entry.activityLabel}
              {data.entry.laneCount != null && (
                <>
                  {" "}
                  · {data.entry.laneCount} lane
                  {data.entry.laneCount === 1 ? "" : "s"} ·{" "}
                  {data.entry.sessionMinutes === 60 ? "1 hour" : "30 min"}
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Your spot updates live for everyone in line
            </p>

            {data.entry.status === "waiting" ? (
              <div className="mt-10 rounded-3xl border border-white/10 bg-[#141414] p-8">
                <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
                  Your position
                </p>
                <p className="mt-2 text-6xl font-semibold tabular-nums text-white">
                  #{data.position}
                </p>
                <p className="mt-4 text-neutral-400">
                  Estimated wait ~{data.estimatedWaitMinutes} min
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
