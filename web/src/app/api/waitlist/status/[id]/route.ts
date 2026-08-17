import { after, NextResponse } from "next/server";
import {
  getWaitlistStatus,
  type WaitlistStatusSnapshot,
} from "@/lib/store";
import { ACTIVITY_LABELS } from "@/lib/types";
import { refreshLiveLaneSources } from "@/lib/live-lane-availability";
import { withDeadline } from "@/lib/async-deadline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT = Symbol("STATUS_TIMEOUT");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  after(refreshLiveLaneSources);
  const result = await withDeadline<
    WaitlistStatusSnapshot | null | typeof STATUS_TIMEOUT
  >(
    getWaitlistStatus(id),
    STATUS_TIMEOUT_MS,
    STATUS_TIMEOUT,
  );

  if (result === STATUS_TIMEOUT) {
    return NextResponse.json(
      {
        error: "Waitlist status is temporarily slow. Please retry.",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { entry, position, estimatedWaitMinutes, availabilityStatus } = result;

  return NextResponse.json({
    entry: {
      id: entry.id,
      name: entry.name,
      activity: entry.activity,
      activityLabel: ACTIVITY_LABELS[entry.activity],
      status: entry.status,
      laneCount: entry.laneCount,
      sessionMinutes: entry.sessionMinutes,
    },
    position,
    estimatedWaitMinutes,
    availabilityStatus,
    checkedAt: new Date().toISOString(),
  });
}
