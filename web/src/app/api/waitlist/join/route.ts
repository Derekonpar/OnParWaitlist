import { NextResponse } from "next/server";
import { z } from "zod";
import { joinWaitlist, getPosition, recordSmsAttempt } from "@/lib/store";
import {
  ACTIVITIES,
  ACTIVITY_LABELS,
  type LaneCount,
  type SessionDuration,
} from "@/lib/types";
import {
  defaultSessionMinutesFor,
  isValidLaneCount,
  isValidSessionMinutes,
} from "@/lib/booking";
import { validatePublicGuestName } from "@/lib/public-guest-name-policy";
import { smsStatusCallbackUrl, statusPageUrl } from "@/lib/app-url";
import { isSmsOptedOut } from "@/lib/sms-consent";
import {
  buildJoinConfirmation,
  sendSms,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function trimString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

const joinSchema = z.object({
  activity: z.enum(ACTIVITIES),
  firstName: z.preprocess(trimString, z.string().min(1).max(40)),
  lastName: z.preprocess(trimString, z.string().min(1).max(40)),
  phone: z.preprocess(
    trimString,
    z
      .string()
      .min(7)
      .max(24)
      .refine((v) => v.replace(/\D/g, "").length >= 10, {
        message: "Enter at least 10 digits",
      }),
  ),
  smsOptIn: z.literal(true),
  rewardsOptIn: z.boolean().optional(),
  laneCount: z.coerce.number().int().default(1),
  sessionMinutes: z.coerce.number().int().optional(),
}).superRefine((data, ctx) => {
  if (!isValidLaneCount(data.activity, data.laneCount)) {
    ctx.addIssue({
      code: "custom",
      path: ["laneCount"],
      message: "Invalid lane count for this activity",
    });
  }
  if (
    data.sessionMinutes !== undefined &&
    !isValidSessionMinutes(data.activity, data.sessionMinutes)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["sessionMinutes"],
      message: "Invalid session length for this activity",
    });
  }
});

function joinValidationMessage(details: {
  fieldErrors: Record<string, string[] | undefined>;
}): string {
  const phone = details.fieldErrors.phone?.[0];
  if (phone) {
    return "Please enter a complete 10-digit mobile number.";
  }
  const firstName = details.fieldErrors.firstName?.[0];
  if (firstName) return "Please enter your first name.";
  const lastName = details.fieldErrors.lastName?.[0];
  if (lastName) return "Please enter your last name.";
  const lane = details.fieldErrors.laneCount?.[0];
  if (lane) return "Please choose a valid quantity.";
  const session = details.fieldErrors.sessionMinutes?.[0];
  if (session) return "Please choose a valid session length.";
  const sms = details.fieldErrors.smsOptIn?.[0];
  if (sms) return "Online waitlist signup includes transactional text updates. See the host for a non-SMS option.";
  return "Please check your entries and try again.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.flatten();
      return NextResponse.json(
        {
          error: joinValidationMessage(details),
          details,
        },
        { status: 400 },
      );
    }

    const {
      activity,
      firstName,
      lastName,
      phone,
      smsOptIn,
      rewardsOptIn,
      laneCount,
      sessionMinutes,
    } = parsed.data;
    const guestName = validatePublicGuestName(firstName, lastName);
    if (!guestName.ok) {
      return NextResponse.json(
        {
          code: "INVALID_GUEST_NAME",
          error:
            "That name can’t be used. Please enter your real first and last name, or ask a staff member for help.",
        },
        { status: 400 },
      );
    }

    const name = guestName.fullName;
    const selectedSessionMinutes =
      sessionMinutes ?? defaultSessionMinutesFor(activity);

    if (smsOptIn && (await isSmsOptedOut(phone))) {
      return NextResponse.json(
        {
          error:
            "This number has opted out of texts. Reply START to resubscribe, or see the host for a non-SMS waitlist option.",
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
      entry = await joinWaitlist({
        activity,
        name,
        phone,
        smsOptIn,
        rewardsOptIn: rewardsOptIn ?? false,
        laneCount: laneCount as LaneCount,
        sessionMinutes: selectedSessionMinutes as SessionDuration,
        smsConsentSource: smsOptIn ? "website-primary-action-v1" : undefined,
      });
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

    let smsSent = false;
    if (smsOptIn) {
      const sms = await sendSms(
        entry.phone,
        buildJoinConfirmation(
          entry.name,
          ACTIVITY_LABELS[activity],
          position,
          statusPageUrl(entry.id),
        ),
        smsStatusCallbackUrl(entry.id, "join"),
        { optOutCheck: "already-checked" },
      );
      try {
        await recordSmsAttempt(entry.id, "join", sms);
      } catch (trackingError) {
        console.error("[join sms tracking]", trackingError);
      }
      smsSent = sms.accepted;
    }

    return NextResponse.json({ entry, position, smsSent });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "ALREADY_ON_WAITLIST") {
        return NextResponse.json(
          { error: "You are already on this waitlist." },
          { status: 409 },
        );
      }
      if (err.message === "STORAGE_NOT_CONFIGURED") {
        return NextResponse.json(
          { error: "Waitlist is temporarily unavailable. Please try again soon." },
          { status: 503 },
        );
      }
    }
    console.error("[join]", err);
    return NextResponse.json(
      { error: "Could not join waitlist. Please try again." },
      { status: 500 },
    );
  }
}
