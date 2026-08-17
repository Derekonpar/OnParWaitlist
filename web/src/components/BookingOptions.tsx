"use client";

import {
  ACTIVITY_RESOURCE_LABEL,
  formatSessionLabel,
  laneCountOptions,
  sessionOptionsFor,
} from "@/lib/booking";
import type { Activity, LaneCount, SessionDuration } from "@/lib/types";

interface BookingOptionsProps {
  activity: Activity;
  laneCount: LaneCount;
  sessionMinutes: SessionDuration;
  onLaneCountChange: (value: LaneCount) => void;
  onSessionMinutesChange: (value: SessionDuration) => void;
  compact?: boolean;
}

export function BookingOptions({
  activity,
  laneCount,
  sessionMinutes,
  onLaneCountChange,
  onSessionMinutesChange,
  compact = false,
}: BookingOptionsProps) {
  const labelClass = compact
    ? "mb-1 block text-xs font-medium text-neutral-400"
    : "mb-1.5 block text-sm font-medium text-neutral-300";

  const laneOptions = laneCountOptions(activity);
  const sessionOptions = sessionOptionsFor(activity);
  const laneGridClass =
    laneOptions.length === 5
      ? "grid-cols-5"
      : laneOptions.length <= 2
        ? "grid-cols-2"
        : laneOptions.length === 3
          ? "grid-cols-3"
          : "grid-cols-4";

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <span className={labelClass}>{ACTIVITY_RESOURCE_LABEL[activity]}</span>
        <div className={`grid ${laneGridClass} gap-2`}>
          {laneOptions.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onLaneCountChange(count as LaneCount)}
              className={`rounded-xl border px-2 text-sm font-semibold transition ${
                compact ? "py-2" : "py-2.5"
              } ${
                laneCount === count
                  ? "border-white bg-white text-neutral-900"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={labelClass}>Session length</span>
        <div
          className={`grid gap-2 ${
            sessionOptions.length === 3 ? "grid-cols-3" : "grid-cols-2"
          }`}
        >
          {sessionOptions.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() =>
                onSessionMinutesChange(minutes as SessionDuration)
              }
              className={`rounded-xl border px-3 text-sm font-semibold transition ${
                compact ? "py-2" : "py-2.5"
              } ${
                sessionMinutes === minutes
                  ? "border-white bg-white text-neutral-900"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              {formatSessionLabel(minutes)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
