import { NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import { getQueue } from "@/lib/store";
import { ACTIVITIES, type Activity } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const activity = url.searchParams.get("activity") as Activity | null;

  if (activity && !ACTIVITIES.includes(activity)) {
    return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
  }

  if (activity) {
    const queue = await getQueue(activity);
    return NextResponse.json({ activity, queue });
  }

  const queues = await Promise.all(
    ACTIVITIES.map(async (a) => ({
      activity: a,
      queue: await getQueue(a),
    })),
  );
  return NextResponse.json({ queues });
}
