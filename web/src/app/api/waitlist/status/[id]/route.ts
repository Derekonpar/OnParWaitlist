import { NextResponse } from "next/server";
import { getPosition } from "@/lib/store";
import { ACTIVITY_LABELS, MINUTES_PER_PARTY } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getPosition(id);

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { entry, position } = result;
  const estimatedWait =
    (position - 1) * MINUTES_PER_PARTY[entry.activity];

  return NextResponse.json({
    entry: {
      id: entry.id,
      name: entry.name,
      activity: entry.activity,
      activityLabel: ACTIVITY_LABELS[entry.activity],
      status: entry.status,
    },
    position,
    estimatedWaitMinutes: estimatedWait,
  });
}
