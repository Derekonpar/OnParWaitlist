import { WaitlistDashboard } from "@/components/WaitlistDashboard";
import { getBoard } from "@/lib/store";
import { emptyBoard } from "@/lib/defaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  let initialBoard = emptyBoard();
  try {
    initialBoard = await getBoard();
  } catch (err) {
    console.error("[page] board load failed:", err);
  }

  return <WaitlistDashboard initialBoard={initialBoard} />;
}
