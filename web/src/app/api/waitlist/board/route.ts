import { NextResponse } from "next/server";
import { getBoard } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const board = await getBoard();
    return NextResponse.json({
      board,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[board]", err);
    return NextResponse.json(
      { error: "Could not load waitlist" },
      { status: 500 },
    );
  }
}
