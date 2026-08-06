import { NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import { getEntertainmentSchedule } from "@/lib/entertainment-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schedule = await getEntertainmentSchedule();
  return NextResponse.json({ schedule });
}
