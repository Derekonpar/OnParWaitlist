import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { sendSms } from "@/lib/twilio";
import { getVenueName } from "@/lib/venue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  phone: z
    .string()
    .min(7)
    .max(24)
    .refine((v) => v.replace(/\D/g, "").length >= 10, {
      message: "Enter at least 10 digits",
    }),
});

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 },
      );
    }

    const venue = getVenueName();
    const sent = await sendSms(
      parsed.data.phone,
      `Test from ${venue} waitlist — Twilio is connected! Reply STOP to opt out.`,
    );

    if (!sent) {
      return NextResponse.json(
        {
          error:
            "SMS not sent. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in Vercel env vars, then redeploy.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Test SMS sent. Check your phone in a few seconds.",
    });
  } catch (err) {
    console.error("[test-sms]", err);
    const msg =
      err instanceof Error ? err.message : "Twilio request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
