import { TvWaitBoard } from "@/components/TvWaitBoard";
import { emptyBoard } from "@/lib/defaults";
import { getBoard } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Live Entertainment Waits — On Par",
  description: "TV display of live bowling, darts, pool, and shuffleboard waits.",
};

export default async function ViewPage() {
  let initialBoard = emptyBoard();
  try {
    initialBoard = await getBoard();
  } catch (error) {
    console.error("[view] board load failed", error);
  }
  return <TvWaitBoard initialBoard={initialBoard} />;
}
