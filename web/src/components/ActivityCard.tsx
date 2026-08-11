"use client";

import type { ActivityBoard } from "@/lib/store";
import { formatBookingSummary } from "@/lib/booking";
import {
  ACTIVITY_TAGLINE,
  ACTIVITY_THEME,
  type Activity,
} from "@/lib/types";
import { ActivityIcon } from "./ActivityIcon";

interface ActivityCardProps {
  board: ActivityBoard;
  onJoin: (activity: Activity) => void;
}

export function ActivityCard({ board, onJoin }: ActivityCardProps) {
  const { stats, queue } = board;
  const theme = ACTIVITY_THEME[stats.activity];
  const hasWait = stats.estimatedWaitMinutes > 0;

  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#141414] shadow-xl shadow-black/20">
      <div
        className={`bg-gradient-to-br ${theme.gradient} px-5 pb-4 pt-5`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-white backdrop-blur-sm">
              <ActivityIcon activity={stats.activity} className="h-7 w-7" />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white">
                {stats.label}
              </h2>
              <p className="text-sm text-white/75">
                {ACTIVITY_TAGLINE[stats.activity]}
              </p>
            </div>
          </div>
          <div className="rounded-full bg-black/20 px-3 py-1 text-center backdrop-blur-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
              In line
            </p>
            <p className="text-2xl font-bold tabular-nums leading-none text-white">
              {stats.waitingCount}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl bg-black/25 px-4 py-3 backdrop-blur-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/60">
              Estimated wait
            </p>
            <p className="text-xl font-semibold text-white">
              {hasWait ? (
                <>
                  ~{stats.estimatedWaitMinutes}
                  <span className="ml-1 text-sm font-normal text-white/70">
                    min
                  </span>
                </>
              ) : (
                <span className="text-emerald-200">Walk on</span>
              )}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2.5 py-1 text-xs font-medium text-emerald-100">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            Live
          </span>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Currently waiting
          </p>
          {queue.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-400">
              No waitlist parties ahead.
            </p>
          ) : (
            <ol className="space-y-2">
              {queue.slice(0, 6).map((person) => (
                <li
                  key={person.id}
                  className="flex items-center justify-between rounded-xl bg-neutral-900 px-3 py-2.5"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
                      style={{ backgroundColor: theme.accent }}
                    >
                      {person.position}
                    </span>
                    <span>
                      <span className="block font-medium text-neutral-100">
                        {person.name}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {formatBookingSummary(
                          stats.activity,
                          person.laneCount,
                          person.sessionMinutes,
                        )}
                      </span>
                    </span>
                  </span>
                  {person.status === "notified" && (
                    <span className="text-xs font-medium text-amber-400">
                      Called
                    </span>
                  )}
                </li>
              ))}
              {queue.length > 6 && (
                <li className="text-center text-xs text-neutral-500">
                  +{queue.length - 6} more in line
                </li>
              )}
            </ol>
          )}
        </div>

        <button
          type="button"
          onClick={() => onJoin(stats.activity)}
          className="w-full rounded-2xl bg-white py-3.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100 active:scale-[0.99]"
        >
          Get on waitlist
        </button>
      </div>
    </article>
  );
}
