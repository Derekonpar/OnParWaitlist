import type { ActivityBoard } from "./store";
import { ACTIVITIES, ACTIVITY_LABELS } from "./types";

export function emptyBoard(): ActivityBoard[] {
  return ACTIVITIES.map((activity) => ({
    stats: {
      activity,
      label: ACTIVITY_LABELS[activity],
      waitingCount: 0,
      estimatedWaitMinutes: 0,
      availabilityStatus: "unknown",
    },
    queue: [],
  }));
}
