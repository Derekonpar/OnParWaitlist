import { NextResponse } from "next/server";
import { z } from "zod";
import { joinWaitlist, getPosition } from "@/lib/store";
import { ACTIVITIES } from "@/lib/types";
import { ACTIVITY_LABELS } from "@/lib/types";
import { isSmsOptedOut } from "@/lib/sms-consent";
import {
  buildJoinConfirmation,
  sendSms,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const joinSchema = z.object({
  activity: z.enum(ACTIVITIES),
  name: z.string().min(1).max(80),
  phone: z
    .string()
    .min(7)
    .max(24)
    .refine((v) => v.replace(/\D/g, "").length >= 10, {
      message: "Enter at least 10 digits",
    }),
  smsOptIn: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { activity, name, phone, smsOptIn } = parsed.data;

    if (smsOptIn && (await isSmsOptedOut(phone))) {
      return NextResponse.json(
        {
          error:
            "This number has opted out of texts. Reply START to resubscribe, or join without SMS.",
        },
        { status: 400 },
      );
    }

    if (smsOptIn && !parsed.data.phone) {
      return NextResponse.json(
        { error: "Phone required for SMS notifications" },
        { status: 400 },
      );
    }

    let entry;
    try {
      entry = await joinWaitlist({ activity, name, phone, smsOptIn });
    } catch (e) {
      if (e instanceof Error && e.message === "INVALID_PHONE") {
        return NextResponse.json(
          { error: "Please enter a valid 10-digit mobile number." },
          { status: 400 },
        );
      }
      throw e;
    }
    const positionInfo = await getPosition(entry.id);
    const position = positionInfo?.position ?? 1;

    if (smsOptIn) {
      await sendSms(
        entry.phone,
        buildJoinConfirmation(
          entry.name,
          ACTIVITY_LABELS[activity],
          position,
        ),
      );
    }

    return NextResponse.json({ entry, position });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_ON_WAITLIST") {
      return NextResponse.json(
        { error: "You are already on this waitlist." },
        { status: 409 },
      );
    }
    console.error("[join]", err);
    return NextResponse.json(
      { error: "Could not join waitlist" },
      { status: 500 },
    );
  }
}
