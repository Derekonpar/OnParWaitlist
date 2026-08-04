import { NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import { getDartseeLaneSnapshot } from "@/lib/dartsee-lanes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getDartseeLaneSnapshot();
  return NextResponse.json({ snapshot });
}
