import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { confirmSmsConsent, getEntryById, recallEntry, recordSmsAttempt, updateStatus } from "@/lib/store";
import { ACTIVITY_LABELS } from "@/lib/types";
import { buildReadyMessage, sendSms } from "@/lib/twilio";
import { smsStatusCallbackUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  id: z.string().uuid(),
  confirmSmsConsent: z.boolean().optional(),
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

    let existing = await getEntryById(parsed.data.id);
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
      if (!existing.smsOptIn && !parsed.data.confirmSmsConsent) {
        return NextResponse.json(
          {
            error: "SMS consent must be confirmed before resending this older record.",
            code: "SMS_CONSENT_REQUIRED",
          },
          { status: 409 },
        );
      }
      if (!existing.smsOptIn) {
        existing = (await confirmSmsConsent(existing.id)) ?? existing;
      }
      if (existing.smsOptIn) {
        const sms = await sendSms(
          existing.phone,
          buildReadyMessage(
            existing.name,
            ACTIVITY_LABELS[existing.activity],
          ),
          smsStatusCallbackUrl(existing.id, "notify"),
        );
        try {
          await recordSmsAttempt(existing.id, "notify", sms);
        } catch (trackingError) {
          console.error("[recall sms tracking]", trackingError);
        }
        resentSms = sms.accepted;
        if (sms.accepted) {
          entry = (await updateStatus(existing.id, "notified")) ?? existing;
        }
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
