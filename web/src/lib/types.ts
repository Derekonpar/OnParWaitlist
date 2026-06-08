export const ACTIVITIES = [
  "bowling",
  "darts",
  "pool",
  "shuffleboard",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

export type WaitlistStatus = "waiting" | "notified" | "served" | "cancelled";

export const LANE_COUNTS = [1, 2, 3, 4] as const;
export type LaneCount = (typeof LANE_COUNTS)[number];

export const SESSION_DURATIONS = [30, 60] as const;
export type SessionDuration = (typeof SESSION_DURATIONS)[number];

export interface WaitlistEntry {
  id: string;
  customerId?: string;
  activity: Activity;
  name: string;
  phone: string;
  smsOptIn: boolean;
  laneCount: LaneCount;
  sessionMinutes: SessionDuration;
  status: WaitlistStatus;
  createdAt: string;
  notifiedAt?: string;
}

/** Resource label shown in the join form (lanes for all activities per venue setup). */
export const ACTIVITY_LANE_LABEL: Record<Activity, string> = {
  bowling: "Number of lanes",
  darts: "Number of lanes",
  pool: "Number of lanes",
  shuffleboard: "Number of lanes",
};

export interface ActivityStats {
  activity: Activity;
  label: string;
  waitingCount: number;
  estimatedWaitMinutes: number;
}

export const ACTIVITY_LABELS: Record<Activity, string> = {
  bowling: "Bowling",
  darts: "Darts",
  pool: "Pool",
  shuffleboard: "Shuffleboard",
};

export const ACTIVITY_TAGLINE: Record<Activity, string> = {
  bowling: "Lanes · Shoes · Good times",
  darts: "Steel tip · League night energy",
  pool: "Tables open · Rack 'em up",
  shuffleboard: "Slide · Score · Celebrate",
};

/** Visual theme per activity */
export const ACTIVITY_THEME: Record<
  Activity,
  { gradient: string; accent: string; icon: string }
> = {
  bowling: {
    gradient: "from-violet-600 via-purple-600 to-fuchsia-600",
    accent: "#8b5cf6",
    icon: "bowling",
  },
  darts: {
    gradient: "from-rose-500 via-red-500 to-orange-500",
    accent: "#f43f5e",
    icon: "darts",
  },
  pool: {
    gradient: "from-emerald-500 via-teal-500 to-cyan-500",
    accent: "#10b981",
    icon: "pool",
  },
  shuffleboard: {
    gradient: "from-amber-500 via-orange-500 to-yellow-500",
    accent: "#f59e0b",
    icon: "shuffle",
  },
};

export const MINUTES_PER_PARTY: Record<Activity, number> = {
  bowling: 12,
  darts: 8,
  pool: 10,
  shuffleboard: 10,
};

