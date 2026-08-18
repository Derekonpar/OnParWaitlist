import { NextResponse } from "next/server";

import {
  getSingaPublicStageTransportDiagnostic,
  getSingaPublicStageWait,
} from "@/lib/singa-public-stage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const wait = await getSingaPublicStageWait(request);
  const diagnostic = getSingaPublicStageTransportDiagnostic();
  return NextResponse.json(wait, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "x-onpar-karaoke-outcome": diagnostic.outcome,
      "x-onpar-karaoke-transport": diagnostic.transport,
    },
  });
}
