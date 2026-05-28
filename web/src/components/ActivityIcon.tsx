import type { ReactNode } from "react";
import type { Activity } from "@/lib/types";

const paths: Record<Activity, ReactNode> = {
  bowling: (
    <g fill="currentColor">
      <circle cx="12" cy="14" r="5" opacity="0.9" />
      <circle cx="7" cy="8" r="2.5" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="19" cy="12" r="1.8" />
    </g>
  ),
  darts: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </g>
  ),
  pool: (
    <g fill="currentColor">
      <circle cx="8" cy="12" r="4" />
      <circle cx="15" cy="10" r="3" opacity="0.85" />
      <path
        d="M4 18c2-1 4-1 6 0s4 1 6 0 4 1 6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </g>
  ),
  shuffleboard: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="4" y="8" width="16" height="8" rx="4" />
      <circle cx="9" cy="12" r="2" fill="currentColor" />
      <path d="M14 12h6" />
    </g>
  ),
};

export function ActivityIcon({
  activity,
  className = "h-6 w-6",
}: {
  activity: Activity;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
    >
      {paths[activity]}
    </svg>
  );
}
