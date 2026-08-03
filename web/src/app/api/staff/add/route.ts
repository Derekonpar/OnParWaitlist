import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { joinWaitlist } from "@/lib/store";
import { ACTIVITIES, type LaneCount, type SessionDuration } from "@/lib/types";
import {
  defaultSessionMinutesFor,
  isValidLaneCount,
  isValidSessionMinutes,
} from "@/lib/booking";
import { combineName } from "@/lib/names";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function trimString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

const schema = z
  .object({
    activity: z.enum(ACTIVITIES),
    firstName: z.preprocess(trimString, z.string().min(1).max(40)),
    lastName: z.preprocess(trimString, z.string().min(1).max(40)),
    phone: z
      .string()
      .min(7)
      .max(24)
      .refine((v) => v.replace(/\D/g, "").length >= 10),
    smsOptIn: z.boolean().default(false),
    rewardsOptIn: z.boolean().default(false),
    laneCount: z.coerce.number().int().default(1),
    sessionMinutes: z.coerce.number().int().optional(),
  })
  .superRefine((data, ctx) => {
    if (!isValidLaneCount(data.activity, data.laneCount)) {
      ctx.addIssue({
        code: "custom",
        path: ["laneCount"],
        message: "Invalid lane count",
      });
    }
    if (
      data.sessionMinutes !== undefined &&
      !isValidSessionMinutes(data.activity, data.sessionMinutes)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionMinutes"],
        message: "Invalid session length",
      });
    }
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

    const { activity, firstName, lastName, laneCount, sessionMinutes, ...rest } =
      parsed.data;
    const selectedSessionMinutes =
      sessionMinutes ?? defaultSessionMinutesFor(activity);
    const entry = await joinWaitlist({
      ...rest,
      activity,
      name: combineName(firstName, lastName),
      laneCount: laneCount as LaneCount,
      sessionMinutes: selectedSessionMinutes as SessionDuration,
    });
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
