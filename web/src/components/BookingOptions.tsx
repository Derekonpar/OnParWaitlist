"use client";

import {
  ACTIVITY_LANE_LABEL,
  LANE_COUNTS,
  SESSION_DURATIONS,
  type Activity,
  type LaneCount,
  type SessionDuration,
} from "@/lib/types";

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

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <span className={labelClass}>{ACTIVITY_LANE_LABEL[activity]}</span>
        <div className="grid grid-cols-4 gap-2">
          {LANE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => onLaneCountChange(count)}
              className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${
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
        <div className="grid grid-cols-2 gap-2">
          {SESSION_DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onSessionMinutesChange(minutes)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                sessionMinutes === minutes
                  ? "border-white bg-white text-neutral-900"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              {minutes === 60 ? "Full hour" : "Half hour"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
