import { NextResponse } from "next/server";
import { getStats } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const stats = await getStats();
  return NextResponse.json({ stats, updatedAt: new Date().toISOString() });
}
