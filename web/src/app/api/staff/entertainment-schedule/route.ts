import { after, NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import {
  getEntertainmentSchedule,
  getStoredEntertainmentSchedule,
} from "@/lib/entertainment-schedule";
import { withDeadline } from "@/lib/async-deadline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const SCHEDULE_SAFETY_STALE_AFTER_MS = 120_000;

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const checkedAt = new Date().toISOString();
  const schedule = await withDeadline(
    getStoredEntertainmentSchedule(),
    1_800,
    null,
  );

  after(async () => {
    await getEntertainmentSchedule();
  });

  const fetchedAt = schedule ? new Date(schedule.fetchedAt).getTime() : Number.NaN;
  return NextResponse.json({
    schedule,
    checkedAt,
    ...(schedule ? { dataUpdatedAt: schedule.fetchedAt } : {}),
    stale:
      !schedule ||
      !Number.isFinite(fetchedAt) ||
      Date.now() - fetchedAt > SCHEDULE_SAFETY_STALE_AFTER_MS,
    refreshing: true,
  });
}
