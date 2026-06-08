import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { joinWaitlist } from "@/lib/store";
import { ACTIVITIES } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  activity: z.enum(ACTIVITIES),
  name: z.string().min(1).max(80),
  phone: z
    .string()
    .min(7)
    .max(24)
    .refine((v) => v.replace(/\D/g, "").length >= 10),
  smsOptIn: z.boolean().default(false),
  rewardsOptIn: z.boolean().default(false),
});

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const entry = await joinWaitlist(parsed.data);
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_ON_WAITLIST") {
      return NextResponse.json(
        { error: "Already on this waitlist." },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
    }
    console.error("[staff add]", err);
    return NextResponse.json({ error: "Could not add guest." }, { status: 500 });
  }
}
