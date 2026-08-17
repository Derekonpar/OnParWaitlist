import { after, NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import {
  getDartseeLaneSnapshot,
  getStoredDartseeLaneSnapshot,
} from "@/lib/dartsee-lanes";
import { withDeadline } from "@/lib/async-deadline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const snapshot = await withDeadline(
    getStoredDartseeLaneSnapshot(),
    1_800,
    null,
  );

  after(async () => {
    await getDartseeLaneSnapshot();
  });

  const capturedAt = snapshot ? new Date(snapshot.capturedAt).getTime() : Number.NaN;
  const stale =
    !snapshot ||
    !Number.isFinite(capturedAt) ||
    Date.now() - capturedAt > 60_000;
  return NextResponse.json({
    snapshot,
    checkedAt,
    ...(snapshot ? { dataUpdatedAt: snapshot.receivedAt } : {}),
    stale,
    refreshing: true,
  });
}
