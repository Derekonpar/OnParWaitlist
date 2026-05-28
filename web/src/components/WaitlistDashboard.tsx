"use client";

import { useCallback, useEffect, useState } from "react";
import { ActivityCard } from "./ActivityCard";
import { JoinModal } from "./JoinModal";
import { Header } from "./Header";
import type { ActivityBoard } from "@/lib/store";
import { emptyBoard } from "@/lib/defaults";
import type { Activity } from "@/lib/types";

interface WaitlistDashboardProps {
  initialBoard: ActivityBoard[];
}

export function WaitlistDashboard({ initialBoard }: WaitlistDashboardProps) {
  const [board, setBoard] = useState<ActivityBoard[]>(
    initialBoard.length ? initialBoard : emptyBoard(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinActivity, setJoinActivity] = useState<Activity | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/waitlist/board", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (Array.isArray(data.board) && data.board.length > 0) {
        setBoard(data.board);
        setLastUpdated(data.updatedAt ?? null);
        setError(null);
      }
    } catch {
      setError("Could not refresh — showing last known wait times.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchBoard, 5000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  return (
    <>
      <Header />

      <main className="relative mx-auto w-full max-w-lg flex-1 px-4 pb-10 pt-6 sm:px-5">
        <section className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live venue waitlist
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your turn,
            <span className="block bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
              without the chaos.
            </span>
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-neutral-400">
            Everyone sees the same line in real time. Join once, watch your
            spot move, get a text when you&apos;re up.
          </p>
        </section>

        {error && (
          <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error}
          </p>
        )}

        <div className="space-y-5">
          {board.map((item) => (
            <ActivityCard
              key={item.stats.activity}
              board={item}
              onJoin={setJoinActivity}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-500">
          {loading ? "Updating…" : lastUpdated ? "Updated just now" : "Live"}{" "}
          · refreshes every 5s ·{" "}
          <a href="/qr" className="text-neutral-300 underline hover:text-white">
            Lobby QR
          </a>
        </p>
      </main>

      {joinActivity && (
        <JoinModal
          activity={joinActivity}
          onClose={() => setJoinActivity(null)}
        />
      )}
    </>
  );
}
