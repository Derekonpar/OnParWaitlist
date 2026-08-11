import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import {
  getEntryById,
  getPosition,
  recordSmsAttempt,
  updateEntryDetails,
} from "@/lib/store";
import {
  formatBookingSummary,
  isValidLaneCount,
  isValidSessionMinutes,
} from "@/lib/booking";
import type { LaneCount, SessionDuration } from "@/lib/types";
import { ACTIVITY_LABELS } from "@/lib/types";
import { buildWaitlistUpdate, sendSms } from "@/lib/twilio";
import { smsStatusCallbackUrl, statusPageUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  id: z.string().uuid(),
  phone: z
    .string()
    .min(7)
    .max(24)
    .refine((value) => value.replace(/\D/g, "").length >= 10),
  laneCount: z.coerce.number().int(),
  sessionMinutes: z.coerce.number().int(),
});

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid edit details" }, { status: 400 });
    }
    const existing = await getEntryById(parsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }
    if (
      !isValidLaneCount(existing.activity, parsed.data.laneCount) ||
      !isValidSessionMinutes(existing.activity, parsed.data.sessionMinutes)
    ) {
      return NextResponse.json(
        { error: "Invalid lane count or session time" },
        { status: 400 },
      );
    }
    const entry = await updateEntryDetails(parsed.data.id, {
      phone: parsed.data.phone,
      laneCount: parsed.data.laneCount as LaneCount,
      sessionMinutes: parsed.data.sessionMinutes as SessionDuration,
    });
    if (!entry) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }
    const position = (await getPosition(entry.id))?.position ?? 1;
    let smsSent = false;
    if (entry.smsOptIn) {
      const sms = await sendSms(
        entry.phone,
        buildWaitlistUpdate(
          entry.name,
          ACTIVITY_LABELS[entry.activity],
          formatBookingSummary(
            entry.activity,
            entry.laneCount,
            entry.sessionMinutes,
          ),
          position,
          statusPageUrl(entry.id),
        ),
        smsStatusCallbackUrl(entry.id, "update"),
      );
      try {
        await recordSmsAttempt(entry.id, "update", sms);
      } catch (trackingError) {
        console.error("[staff edit sms tracking]", trackingError);
      }
      smsSent = sms.accepted;
    }
    return NextResponse.json({ entry, position, smsSent });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_ON_WAITLIST") {
      return NextResponse.json(
        { error: "That phone number is already on this waitlist." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }
    console.error("[staff edit]", error);
    return NextResponse.json({ error: "Could not update guest" }, { status: 500 });
  }
}
