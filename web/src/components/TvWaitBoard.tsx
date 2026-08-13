"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityBoard } from "@/lib/store";
import { ACTIVITY_THEME } from "@/lib/types";
import { ActivityIcon } from "./ActivityIcon";

interface TvWaitBoardProps {
  initialBoard: ActivityBoard[];
}

function clockLabel(nowMs: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(nowMs));
}

export function TvWaitBoard({ initialBoard }: TvWaitBoardProps) {
  const [board, setBoard] = useState(initialBoard);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [connected, setConnected] = useState(true);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7_000);
    try {
      const response = await fetch("/api/waitlist/board", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("refresh failed");
      const data = await response.json();
      if (sequence !== refreshSequence.current) return;
      if (Array.isArray(data.board) && data.board.length === 4) {
        if (!data.stale) setBoard(data.board);
        setUpdatedAt(data.updatedAt ?? null);
        setConnected(!data.stale);
      }
    } catch {
      if (sequence === refreshSequence.current) setConnected(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refresh]);

  return (
    <main className="flex min-h-screen flex-col overflow-hidden bg-[#090909] p-[clamp(1rem,2vw,2.5rem)] text-white">
      <header className="mb-[clamp(0.75rem,1.5vh,1.5rem)] flex items-end justify-between gap-6">
        <div>
          <p className="text-[clamp(0.7rem,1vw,1rem)] font-bold uppercase tracking-[0.28em] text-violet-300">
            On Par Entertainment
          </p>
          <h1 className="mt-1 text-[clamp(1.7rem,3vw,3.5rem)] font-black leading-none tracking-tight">
            Live entertainment waits
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[clamp(1.25rem,2.4vw,2.6rem)] font-bold tabular-nums">
            {clockLabel(nowMs)}
          </p>
          <p className={`text-[clamp(0.65rem,0.9vw,0.9rem)] font-semibold ${connected ? "text-emerald-300" : "text-amber-300"}`}>
            {connected
              ? updatedAt
                ? "Live · updates automatically"
                : "Connecting to live waits…"
              : "Reconnecting · showing last known waits"}
          </p>
        </div>
      </header>

      <section className="grid min-h-0 min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-[clamp(0.65rem,1.4vw,1.5rem)]">
        {board.map(({ stats, queue }) => {
          const theme = ACTIVITY_THEME[stats.activity];
          const open = stats.estimatedWaitMinutes <= 0;
          return (
            <article
              key={stats.activity}
              className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[clamp(1rem,2vw,2rem)] border border-white/15 bg-gradient-to-br ${theme.gradient} p-[clamp(0.8rem,2vw,2.5rem)] shadow-2xl shadow-black/30`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-[clamp(0.5rem,1.2vw,1.5rem)]">
                  <span className="flex h-[clamp(3rem,5vw,5.5rem)] w-[clamp(3rem,5vw,5.5rem)] items-center justify-center rounded-[clamp(0.8rem,1.3vw,1.4rem)] bg-white/20 backdrop-blur">
                    <ActivityIcon activity={stats.activity} className="h-3/5 w-3/5" />
                  </span>
                  <h2 className="min-w-0 truncate text-[clamp(1.25rem,2.7vw,3.8rem)] font-black tracking-tight">
                    {stats.label}
                  </h2>
                </div>
                <div className="rounded-full bg-black/25 px-[clamp(0.7rem,1.2vw,1.25rem)] py-[clamp(0.35rem,0.6vw,0.65rem)] text-center backdrop-blur">
                  <p className="text-[clamp(0.55rem,0.75vw,0.8rem)] font-bold uppercase tracking-widest text-white/70">
                    In line
                  </p>
                  <p className="text-[clamp(1.4rem,2.4vw,2.8rem)] font-black tabular-nums leading-none">
                    {stats.waitingCount}
                  </p>
                </div>
              </div>

              <div className="mt-auto rounded-[clamp(0.9rem,1.5vw,1.5rem)] bg-black/30 p-[clamp(0.9rem,1.6vw,1.8rem)] backdrop-blur-sm">
                <p className="text-[clamp(0.65rem,0.9vw,1rem)] font-bold uppercase tracking-[0.2em] text-white/65">
                  Estimated wait
                </p>
                {open ? (
                  <p className="mt-1 truncate text-[clamp(2rem,5.3vw,7rem)] font-black leading-none text-emerald-200">
                    Walk on
                  </p>
                ) : (
                  <p className="mt-1 text-[clamp(3rem,7vw,8rem)] font-black leading-none tabular-nums">
                    {stats.estimatedWaitMinutes}
                    <span className="ml-[0.3em] text-[0.28em] font-bold uppercase tracking-wider text-white/70">
                      min
                    </span>
                  </p>
                )}
                <div className="mt-[clamp(0.45rem,0.8vh,0.8rem)] flex min-w-0 items-center gap-2 border-t border-white/15 pt-[clamp(0.45rem,0.8vh,0.8rem)]">
                  <span className="shrink-0 text-[clamp(0.55rem,0.7vw,0.75rem)] font-bold uppercase tracking-wider text-white/60">
                    Waiting
                  </span>
                  <p className="min-w-0 truncate text-[clamp(0.75rem,1.15vw,1.35rem)] font-semibold text-white/90">
                    {queue.length
                      ? queue.slice(0, 4).map((person) => person.name).join(" · ")
                      : "No parties"}
                    {queue.length > 4 ? ` · +${queue.length - 4} more` : ""}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <footer className="mt-[clamp(0.7rem,1.4vh,1.25rem)] flex items-center justify-between text-[clamp(0.65rem,0.95vw,1rem)] text-neutral-400">
        <p>Waits include live play, current waitlist parties, and protected reservations.</p>
        <p className="font-semibold text-white">Join at onparwaitlist.com</p>
      </footer>
    </main>
  );
}
