import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { getEntryById, recallEntry } from "@/lib/store";
import { ACTIVITY_LABELS } from "@/lib/types";
import { buildReadyMessage, sendSms } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    const existing = await getEntryById(parsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (existing.status === "waiting") {
      return NextResponse.json(
        { error: "Guest is already waiting in line." },
        { status: 400 },
      );
    }

    let entry = existing;
    let resentSms = false;

    if (existing.status === "notified") {
      if (existing.smsOptIn) {
        resentSms = await sendSms(
          existing.phone,
          buildReadyMessage(
            existing.name,
            ACTIVITY_LABELS[existing.activity],
          ),
        );
      }
    } else if (
      existing.status === "served" ||
      existing.status === "cancelled"
    ) {
      const result = await recallEntry(parsed.data.id);
      if (!result?.entry) {
        return NextResponse.json({ error: "Could not recall guest" }, { status: 500 });
      }
      entry = result.entry;
    } else {
      return NextResponse.json({ error: "Cannot recall this guest" }, { status: 400 });
    }

    return NextResponse.json({ entry, resentSms });
  } catch (err) {
    console.error("[recall]", err);
    return NextResponse.json({ error: "Recall failed" }, { status: 500 });
  }
}
