import { NextResponse } from "next/server";
import { getBoard } from "@/lib/store";
import { emptyBoard } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BOARD_TIMEOUT_MS = 5_000;

async function boardWithDeadline() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getBoard().then((board) => ({ board, stale: false })),
      new Promise<{ board: ReturnType<typeof emptyBoard>; stale: boolean }>(
        (resolve) => {
          timer = setTimeout(
            () => resolve({ board: emptyBoard(), stale: true }),
            BOARD_TIMEOUT_MS,
          );
        },
      ),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  try {
    const { board, stale } = await boardWithDeadline();
    return NextResponse.json({
      board,
      updatedAt: new Date().toISOString(),
      stale,
    });
  } catch (err) {
    console.error("[board]", err);
    return NextResponse.json(
      { error: "Could not load waitlist" },
      { status: 500 },
    );
  }
}
