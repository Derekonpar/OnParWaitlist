import { WaitlistDashboard } from "@/components/WaitlistDashboard";
import { getBoard } from "@/lib/store";
import { emptyBoard } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export default async function HomePage() {
  let initialBoard = emptyBoard();
  try {
    initialBoard = await initialBoardWithDeadline();
  } catch (err) {
    console.error("[page] board load failed:", err);
  }

  return <WaitlistDashboard initialBoard={initialBoard} />;
}
