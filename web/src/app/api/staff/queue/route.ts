import { NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import { getStaffQueues } from "@/lib/store";
import { isPublicBowlingNoWaitOverrideEnabled } from "@/lib/public-display-override.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queues = await getStaffQueues();
  return NextResponse.json(
    { queues, bowlingNoWaitOverride: isPublicBowlingNoWaitOverrideEnabled() },
    { headers: { "cache-control": "no-store" } },
  );
}
