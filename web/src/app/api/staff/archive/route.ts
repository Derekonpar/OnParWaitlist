import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { archiveEntry } from "@/lib/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const entry = await archiveEntry(parsed.data.id);
    if (!entry) {
      return NextResponse.json(
        { error: "Only served or removed guests can be deleted to archive" },
        { status: 400 },
      );
    }

    return NextResponse.json({ entry });
  } catch (err) {
    console.error("[archive]", err);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}
