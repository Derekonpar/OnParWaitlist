import { NextResponse } from "next/server";
import { getStorageStatus } from "@/lib/store";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Internal diagnostics — safe column names only, no secrets. */
export async function GET() {
  const storage = await getStorageStatus();
  const supabase = getSupabaseAdmin();

  let waitlistColumns: string[] = [];
  let sampleKeys: string[] = [];
  let rowCount = 0;

  if (supabase) {
    const { data, error } = await supabase
      .from("waitlist_entries")
      .select("*")
      .limit(1);
    if (!error && data?.[0]) {
      sampleKeys = Object.keys(data[0]);
      waitlistColumns = sampleKeys;
    }
    const { count } = await supabase
      .from("waitlist_entries")
      .select("id", { count: "exact", head: true });
    rowCount = count ?? 0;
  }

  return NextResponse.json({
    storage,
    waitlistColumns,
    sampleKeys,
    rowCount,
  });
}
