import { NextResponse } from "next/server";
import { z } from "zod";
import { addSmsOptOut } from "@/lib/sms-consent";
import { cancelActiveEntriesForPhone } from "@/lib/store";

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
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please enter a valid mobile number." },
        { status: 400 },
      );
    }

    await addSmsOptOut(parsed.data.phone);
    await cancelActiveEntriesForPhone(parsed.data.phone);

    return NextResponse.json({
      success: true,
      message:
        "You have been unsubscribed from On Par waitlist text messages.",
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_PHONE") {
      return NextResponse.json(
        { error: "Please enter a valid mobile number." },
        { status: 400 },
      );
    }
    console.error("[sms opt-out]", err);
    return NextResponse.json(
      { error: "Could not process opt-out." },
      { status: 500 },
    );
  }
}
