import { NextResponse } from "next/server";
import { verifyStaffSecret } from "@/lib/auth";
import { getStorageStatus } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getStorageStatus();
  return NextResponse.json(status);
}
