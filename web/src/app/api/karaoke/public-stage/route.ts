import { NextResponse } from "next/server";

import { getSingaPublicStageWait } from "@/lib/singa-public-stage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const wait = await getSingaPublicStageWait();
  return NextResponse.json(wait, {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  });
}
