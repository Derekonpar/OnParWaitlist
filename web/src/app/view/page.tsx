import { TvWaitBoard } from "@/components/TvWaitBoard";
import { emptyBoard } from "@/lib/defaults";
import { getBoard } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Live Entertainment Waits — On Par",
  description: "TV display of live bowling, darts, pool, and shuffleboard waits.",
};

const INITIAL_BOARD_TIMEOUT_MS = 1_500;

async function initialBoardWithDeadline() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getBoard(),
      new Promise<ReturnType<typeof emptyBoard>>((resolve) => {
        timer = setTimeout(() => resolve(emptyBoard()), INITIAL_BOARD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default async function ViewPage() {
  let initialBoard = emptyBoard();
  try {
    initialBoard = await initialBoardWithDeadline();
  } catch (error) {
    console.error("[view] board load failed", error);
  }
  return <TvWaitBoard initialBoard={initialBoard} />;
}
