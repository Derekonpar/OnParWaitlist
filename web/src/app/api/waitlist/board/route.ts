import { after, NextResponse } from "next/server";
import { getBoard } from "@/lib/store";
import { emptyBoard } from "@/lib/defaults";
import { refreshLiveLaneSources } from "@/lib/live-lane-availability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BOARD_TIMEOUT_MS = 5_000;

async function boardWithDeadline() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getBoard().then((board) => ({
        board,
        stale: false as const,
        dataUpdatedAt: new Date().toISOString(),
      })),
      new Promise<{
        board: ReturnType<typeof emptyBoard>;
        stale: true;
        dataUpdatedAt?: never;
      }>(
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
  const checkedAt = new Date().toISOString();
  after(refreshLiveLaneSources);
  try {
    const result = await boardWithDeadline();
    return NextResponse.json(
      {
        board: result.board,
        stale: result.stale,
        checkedAt,
        ...(result.dataUpdatedAt
          ? {
              dataUpdatedAt: result.dataUpdatedAt,
              // Backward compatibility for current clients. A timeout does not
              // emit this field, so empty fallback data is never stamped fresh.
              updatedAt: result.dataUpdatedAt,
            }
          : {}),
      },
      // Existing open pages already preserve their last-known board on a
      // non-success response. Returning 503 keeps those pre-release clients
      // from replacing real guests with the synthetic timeout fallback.
      { status: result.stale ? 503 : 200 },
    );
  } catch (err) {
    console.error("[board]", err);
    return NextResponse.json(
      { error: "Could not load waitlist" },
      { status: 500 },
    );
  }
}
