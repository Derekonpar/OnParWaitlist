"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ActivityBoard } from "@/lib/store";
import type {
  SingaPublicStageLastKnown,
  SingaPublicStageWait,
} from "@/lib/singa-public-stage-contract";
import { ACTIVITY_THEME } from "@/lib/types";
import { ActivityIcon } from "./ActivityIcon";

interface TvWaitBoardProps {
  initialBoard: ActivityBoard[];
}

interface EntertainmentCardProps {
  label: string;
  icon: ReactNode;
  gradient: string;
  status: ReactNode;
  statusTone: string;
  statusLabel: string;
  waitingCount?: number;
  queue?: ActivityBoard["queue"];
  detail?: string;
}

function clockLabel(nowMs: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(nowMs));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function validLastKnown(value: unknown): value is SingaPublicStageLastKnown {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SingaPublicStageLastKnown>;
  if (!validDate(candidate.dataUpdatedAt)) return false;
  if (candidate.status === "inactive") return candidate.waitMinutes === null;
  return (
    candidate.status === "active" &&
    typeof candidate.waitMinutes === "number" &&
    Number.isSafeInteger(candidate.waitMinutes) &&
    candidate.waitMinutes >= 0
  );
}

function validSingaWait(value: unknown): value is SingaPublicStageWait {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!validDate(candidate.checkedAt)) return false;
  if (candidate.status === "active") {
    return (
      candidate.stale === false &&
      validDate(candidate.dataUpdatedAt) &&
      typeof candidate.waitMinutes === "number" &&
      Number.isSafeInteger(candidate.waitMinutes) &&
      candidate.waitMinutes >= 0
    );
  }
  if (candidate.status === "inactive") {
    return (
      candidate.stale === false &&
      candidate.waitMinutes === null &&
      validDate(candidate.dataUpdatedAt)
    );
  }
  return (
    candidate.status === "unavailable" &&
    candidate.waitMinutes === null &&
    typeof candidate.stale === "boolean" &&
    (candidate.dataUpdatedAt === null || validDate(candidate.dataUpdatedAt)) &&
    (candidate.lastKnown === null || validLastKnown(candidate.lastKnown))
  );
}

function unavailableSingaWait(
  current: SingaPublicStageWait | null,
): SingaPublicStageWait {
  const checkedAt = new Date().toISOString();
  const lastKnown =
    current?.status === "active" || current?.status === "inactive"
      ? {
          status: current.status,
          waitMinutes: current.waitMinutes,
          dataUpdatedAt: current.dataUpdatedAt,
        }
      : current?.lastKnown ?? null;
  const lastKnownAt = lastKnown
    ? new Date(lastKnown.dataUpdatedAt).getTime()
    : Number.NaN;
  const recentLastKnown =
    lastKnown && Number.isFinite(lastKnownAt) && Date.now() - lastKnownAt <= 60_000
      ? lastKnown
      : null;
  return {
    status: "unavailable",
    waitMinutes: null,
    stale: recentLastKnown !== null,
    checkedAt,
    dataUpdatedAt: recentLastKnown?.dataUpdatedAt ?? null,
    lastKnown: recentLastKnown,
  };
}

function MiniGolfIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" aria-hidden>
      <path d="M7 3v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 4h8l-3 4H8" fill="currentColor" />
      <ellipse cx="12" cy="18" rx="7" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function KaraokeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" aria-hidden>
      <path d="M15.5 4.5a4 4 0 0 0-5.7 5.6l1.2 1.2 5.7-5.7-1.2-1.1Z" fill="currentColor" />
      <path d="m11.7 10.5-6.2 6.2 1.8 1.8 6.2-6.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 20h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EntertainmentCard({
  label,
  icon,
  gradient,
  status,
  statusTone,
  statusLabel,
  waitingCount,
  queue,
  detail,
}: EntertainmentCardProps) {
  return (
    <article
      data-entertainment-card
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[clamp(1rem,1.6vw,1.7rem)] border border-white/15 bg-gradient-to-br ${gradient} p-[clamp(0.65rem,0.9vw,1.1rem)] shadow-2xl shadow-black/30`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-[clamp(0.5rem,0.8vw,0.9rem)]">
          <span className="flex h-[clamp(2.4rem,3.2vw,3.7rem)] w-[clamp(2.4rem,3.2vw,3.7rem)] shrink-0 items-center justify-center rounded-[clamp(0.75rem,1vw,1rem)] bg-white/20 backdrop-blur">
            {icon}
          </span>
          <h2 className="min-w-0 text-[clamp(1.15rem,1.75vw,2.1rem)] font-black leading-tight tracking-tight">
            {label}
          </h2>
        </div>
        {typeof waitingCount === "number" ? (
          <div className="shrink-0 rounded-full bg-black/25 px-[clamp(0.55rem,0.75vw,0.8rem)] py-1 text-center backdrop-blur">
            <p className="text-[clamp(0.48rem,0.55vw,0.62rem)] font-bold uppercase tracking-widest text-white/65">
              In line
            </p>
            <p className="text-[clamp(1.15rem,1.55vw,1.8rem)] font-black tabular-nums leading-none">
              {waitingCount}
            </p>
          </div>
        ) : (
          <span className="shrink-0 rounded-full bg-black/25 px-3 py-2 text-[clamp(0.52rem,0.62vw,0.7rem)] font-bold uppercase tracking-widest text-white/70">
            House status
          </span>
        )}
      </div>

      {queue ? (
        <div
          data-tv-queue-preview
          className="mt-[clamp(0.35rem,0.55vh,0.6rem)] min-h-0 flex-1 overflow-hidden"
        >
          {queue.length ? (
            <ol className="space-y-[clamp(0.3rem,0.55vh,0.45rem)]">
              {queue.slice(0, 4).map((person) => (
                <li
                  key={person.id}
                  className="flex min-h-[clamp(2.25rem,4.6vh,2.75rem)] min-w-0 items-center gap-[clamp(0.5rem,0.7vw,0.75rem)] rounded-xl bg-black/30 px-[clamp(0.55rem,0.75vw,0.8rem)] py-[clamp(0.35rem,0.55vh,0.5rem)]"
                >
                  <span className="flex h-[clamp(1.6rem,2vw,2rem)] w-[clamp(1.6rem,2vw,2rem)] shrink-0 items-center justify-center rounded-full bg-white/25 text-[clamp(0.78rem,0.95vw,1rem)] font-black tabular-nums">
                    {person.position}
                  </span>
                  <span className="min-w-0 truncate text-[clamp(1rem,1.35vw,1.5rem)] font-black leading-tight tracking-tight text-white">
                    {person.name}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-lg bg-black/15 px-3 py-2 text-[clamp(0.65rem,0.82vw,0.92rem)] font-semibold text-white/65">
              No parties waiting
            </p>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <div
        data-tv-wait-summary
        className="mt-auto shrink-0 rounded-[clamp(0.85rem,1vw,1.15rem)] bg-black/30 p-[clamp(0.55rem,0.75vw,0.85rem)] backdrop-blur-sm"
      >
        <p className="text-[clamp(0.55rem,0.68vw,0.75rem)] font-bold uppercase tracking-[0.18em] text-white/65">
          {statusLabel}
        </p>
        <div className={`mt-1 truncate text-[clamp(1.6rem,2.4vw,3.2rem)] font-black leading-none ${statusTone}`}>
          {status}
        </div>
        {detail ? (
          <p className="mt-[clamp(0.4rem,0.6vh,0.6rem)] truncate border-t border-white/15 pt-[clamp(0.35rem,0.55vh,0.55rem)] text-[clamp(0.62rem,0.78vw,0.88rem)] font-semibold text-white/75">
            {detail}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export function TvWaitBoard({ initialBoard }: TvWaitBoardProps) {
  const [board, setBoard] = useState(initialBoard);
  const [karaokeWait, setKaraokeWait] =
    useState<SingaPublicStageWait | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [connected, setConnected] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const karaokeRefreshController = useRef<AbortController | null>(null);
  const hasUnknownWaits = board.some(
    ({ stats }) => stats.availabilityStatus === "unknown",
  );

  const refresh = useCallback(async () => {
    if (refreshController.current) return;

    const sequence = ++refreshSequence.current;
    const controller = new AbortController();
    refreshController.current = controller;
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
        if (data.stale) {
          setConnected(false);
          return;
        }
        setBoard(data.board);
        setConnected(true);
        setUpdatedAt(data.updatedAt ?? null);
      }
    } catch {
      // Keep the last known board while the next scheduled refresh retries.
      if (sequence === refreshSequence.current) setConnected(false);
    } finally {
      window.clearTimeout(timeout);
      if (refreshController.current === controller) {
        refreshController.current = null;
      }
    }
  }, []);

  const refreshKaraoke = useCallback(async () => {
    if (document.hidden || karaokeRefreshController.current) return;

    const controller = new AbortController();
    karaokeRefreshController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetch("/api/karaoke/public-stage", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("karaoke refresh failed");
      const data = (await response.json()) as unknown;
      if (!validSingaWait(data)) throw new Error("invalid karaoke response");
      setKaraokeWait(data);
    } catch {
      setKaraokeWait((current) => unavailableSingaWait(current));
    } finally {
      window.clearTimeout(timeout);
      if (karaokeRefreshController.current === controller) {
        karaokeRefreshController.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const refreshTimer = window.setInterval(() => void refresh(), 15_000);
    const initialKaraoke = window.setTimeout(() => void refreshKaraoke(), 0);
    const karaokeRefreshTimer = window.setInterval(
      () => void refreshKaraoke(),
      15_000,
    );
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    const handleVisibility = () => {
      if (!document.hidden) void refreshKaraoke();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(initialKaraoke);
      window.clearInterval(refreshTimer);
      window.clearInterval(karaokeRefreshTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      refreshSequence.current += 1;
      refreshController.current?.abort();
      refreshController.current = null;
      karaokeRefreshController.current?.abort();
      karaokeRefreshController.current = null;
    };
  }, [refresh, refreshKaraoke]);

  const karaokeActive = karaokeWait?.status === "active";
  const karaokeInactive = karaokeWait?.status === "inactive";
  const karaokeNoWait = karaokeActive && karaokeWait.waitMinutes === 0;

  return (
    <main className="flex h-screen max-h-screen flex-col overflow-hidden bg-[#090909] p-[clamp(0.75rem,1.6vw,2rem)] text-white">
      <header className="mb-[clamp(0.5rem,1vh,1rem)] flex items-end justify-between gap-6">
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
          <p
            className={`mt-1 text-[clamp(0.58rem,0.75vw,0.82rem)] font-bold uppercase tracking-[0.16em] ${
              connected && !hasUnknownWaits
                ? "text-emerald-300"
                : "text-amber-300"
            }`}
            aria-live="polite"
          >
            {connected
              ? updatedAt
                ? hasUnknownWaits
                  ? "Updating live feeds · latest queue shown"
                  : "Live waits"
                : "Connecting to live waits"
              : "Updating · showing last known"}
          </p>
        </div>
      </header>

      <section
        aria-label="Entertainment wait status and waitlist signup"
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[repeat(3,minmax(0,1fr))_minmax(20rem,0.9fr)] grid-rows-2 gap-[clamp(0.6rem,1vw,1rem)]"
      >
        {board.map(({ stats, queue }) => {
          const theme = ACTIVITY_THEME[stats.activity];
          const waitKnown = stats.availabilityStatus === "live";
          const open = waitKnown && stats.estimatedWaitMinutes <= 0;
          return (
            <EntertainmentCard
              key={stats.activity}
              label={stats.label}
              icon={<ActivityIcon activity={stats.activity} className="h-3/5 w-3/5" />}
              gradient={theme.gradient}
              status={
                !waitKnown ? (
                  "Updating"
                ) : open ? (
                  "No Wait"
                ) : (
                  <>
                    {stats.estimatedWaitMinutes}
                    <span className="ml-[0.3em] text-[0.28em] font-bold uppercase tracking-wider text-white/70">
                      min
                    </span>
                  </>
                )
              }
              statusTone={
                !waitKnown
                  ? "text-amber-200"
                  : open
                    ? "text-emerald-200"
                    : "text-white"
              }
              statusLabel={waitKnown ? "Estimated wait" : "Live feed"}
              waitingCount={stats.waitingCount}
              queue={queue}
            />
          );
        })}

        <EntertainmentCard
          label="Mini Golf"
          icon={<MiniGolfIcon />}
          gradient="from-emerald-700 via-teal-700 to-cyan-700"
          status="No Wait"
          statusTone="text-emerald-200"
          statusLabel="Current status"
          detail="Always available"
        />

        <EntertainmentCard
          label="Karaoke"
          icon={<KaraokeIcon />}
          gradient="from-violet-700 via-fuchsia-700 to-pink-700"
          status={
            karaokeActive ? (
              karaokeNoWait ? (
                "No Wait"
              ) : (
                <>
                  {karaokeWait.waitMinutes}
                  <span className="ml-[0.3em] text-[0.28em] font-bold uppercase tracking-wider text-white/70">
                    min
                  </span>
                </>
              )
            ) : karaokeInactive ? (
              "Not Open"
            ) : karaokeWait ? (
              "Updating"
            ) : (
              "Connecting"
            )
          }
          statusTone={
            karaokeNoWait
              ? "text-emerald-200"
              : karaokeWait?.status === "unavailable" || !karaokeWait
                ? "text-amber-200"
                : "text-white"
          }
          statusLabel={karaokeActive ? "Estimated wait" : "Main Stage"}
          detail={
            karaokeActive
              ? "Public karaoke requests are open"
              : karaokeInactive
                ? "Public karaoke requests are not open"
                : "Wait time temporarily unavailable"
          }
        />

        <aside className="col-start-4 row-span-2 row-start-1 flex min-h-0 flex-col items-center justify-center rounded-[clamp(1rem,1.6vw,1.7rem)] border border-violet-300/20 bg-gradient-to-b from-violet-950 via-[#17102b] to-[#0f0d18] p-[clamp(1rem,1.5vw,1.75rem)] text-center shadow-2xl shadow-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/on-par-logo-full.png"
            alt="On Par Entertainment"
            width={1580}
            height={795}
            className="mb-[clamp(0.45rem,0.9vh,0.8rem)] h-[clamp(4.75rem,9vh,7rem)] w-auto max-w-full invert"
          />
          <p className="text-[clamp(0.68rem,0.85vw,0.95rem)] font-bold uppercase tracking-[0.22em] text-violet-300">
            Join from your phone
          </p>
          <h2 className="mt-2 text-[clamp(1.5rem,2.2vw,2.8rem)] font-black leading-tight">
            Put yourself on the waitlist
          </h2>
          <div className="mt-[clamp(1rem,2vh,1.6rem)] rounded-[clamp(1rem,1.3vw,1.35rem)] bg-white p-[clamp(0.65rem,0.9vw,0.9rem)] shadow-2xl shadow-violet-950/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/waitlist-qr.png"
              alt="QR code for onparwaitlist.com"
              width={240}
              height={240}
              className="h-[clamp(12rem,16vw,16rem)] w-[clamp(12rem,16vw,16rem)]"
            />
          </div>
          <p className="mt-[clamp(0.9rem,1.6vh,1.25rem)] text-[clamp(0.8rem,1.05vw,1.2rem)] font-bold text-white">
            Scan with your camera
          </p>
          <p className="mt-1 text-[clamp(0.68rem,0.82vw,0.92rem)] font-semibold text-violet-200">
            or visit onparwaitlist.com
          </p>
        </aside>
      </section>
    </main>
  );
}
