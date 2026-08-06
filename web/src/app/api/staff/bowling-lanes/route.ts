import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import {
  getBowlingLaneSnapshot,
  normalizeBowlingLaneSnapshot,
  saveBowlingLaneSnapshot,
  saveBowlingLaneHealth,
} from "@/lib/bowling-lanes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const laneSchema = z.object({
  lane: z.number().int().min(1).max(12),
  status: z.enum(["open", "occupied", "reserved", "unknown"]),
  remainingSeconds: z.number().int().min(0).max(12 * 60 * 60).default(0),
  rawText: z.string().max(100).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reservationLabel: z.string().max(100).optional(),
});

const postSchema = z.object({
  lanes: z.array(laneSchema).min(1).max(12).optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.string().max(80).optional(),
  healthStatus: z
    .enum(["recovering", "login-required", "remote-offline", "error"])
    .optional(),
  healthMessage: z.string().trim().min(1).max(300).optional(),
}).refine(
  (data) =>
    Boolean(data.lanes) || Boolean(data.healthStatus && data.healthMessage),
  { message: "Snapshot lanes or health status required" },
);

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getBowlingLaneSnapshot();
  return NextResponse.json({ snapshot });
}

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid lane snapshot", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const saved = parsed.data.lanes
      ? await saveBowlingLaneSnapshot(
          normalizeBowlingLaneSnapshot({
            lanes: parsed.data.lanes,
            capturedAt: parsed.data.capturedAt,
            source: parsed.data.source,
          }),
        )
      : await saveBowlingLaneHealth({
          healthStatus: parsed.data.healthStatus!,
          healthMessage: parsed.data.healthMessage!,
        });
    return NextResponse.json({ snapshot: saved });
  } catch (err) {
    console.error("[bowling lanes]", err);
    return NextResponse.json(
      { error: "Could not save lane snapshot" },
      { status: 500 },
    );
  }
}
