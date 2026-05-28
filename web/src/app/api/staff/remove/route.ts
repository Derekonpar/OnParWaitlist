import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { updateStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const entry = await updateStatus(parsed.data.id, "cancelled");
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
