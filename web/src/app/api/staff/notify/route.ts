import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { recordSmsAttempt, updateStatus } from "@/lib/store";
import { ACTIVITY_LABELS } from "@/lib/types";
import { buildReadyMessage, sendSms } from "@/lib/twilio";
import { smsStatusCallbackUrl } from "@/lib/app-url";

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

    const entry = await updateStatus(parsed.data.id, "notified");
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let smsSent = false;
    let smsStatus: string | undefined;
    if (entry.smsOptIn) {
      const sms = await sendSms(
        entry.phone,
        buildReadyMessage(entry.name, ACTIVITY_LABELS[entry.activity]),
        smsStatusCallbackUrl(entry.id, "notify"),
      );
      try {
        await recordSmsAttempt(entry.id, "notify", sms);
      } catch (trackingError) {
        console.error("[notify sms tracking]", trackingError);
      }
      smsSent = sms.accepted;
      smsStatus = sms.status;
    }

    return NextResponse.json({ entry, smsSent, smsStatus });
  } catch (err) {
    console.error("[notify]", err);
    return NextResponse.json({ error: "Notify failed" }, { status: 500 });
  }
}
