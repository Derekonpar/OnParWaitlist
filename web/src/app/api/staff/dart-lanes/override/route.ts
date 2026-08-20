import { after, NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffHeaderSecret } from "@/lib/auth";
import {
  overrideDartseeLaneSession,
  publishConfirmedDartseeStart,
  refreshDartseeLaneSnapshotAfterControl,
  type DartseeLaneOverrideFailureCode,
} from "@/lib/dartsee-lanes";
import {
  DARTSEE_OVERRIDE_MAX_MINUTES,
  DARTSEE_OVERRIDE_MIN_MINUTES,
} from "@/lib/dartsee-duration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const overrideSchema = z
  .object({
    requestId: z.string().uuid(),
    lane: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    durationMinutes: z
      .number()
      .int()
      .min(DARTSEE_OVERRIDE_MIN_MINUTES)
      .max(DARTSEE_OVERRIDE_MAX_MINUTES),
  })
  .strict();

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function scheduleBackgroundWork(task: () => void | Promise<void>) {
  try {
    after(task);
  } catch {
    // Normal live polling remains the safe fallback after a command result.
    console.warn("[dartsee lane:override] background refresh unavailable");
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function failureResponse(code: DartseeLaneOverrideFailureCode) {
  if (code === "already-in-progress") {
    return privateJson(
      {
        error: "This dart lane is already being checked.",
        code: "DART_CONTROL_ALREADY_IN_PROGRESS",
      },
      409,
    );
  }
  if (code === "schedule-unavailable") {
    return privateJson(
      {
        error:
          "Reservation protection is updating. Refresh the schedule before overriding this lane.",
        code: "SCHEDULE_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "feed-unavailable") {
    return privateJson(
      {
        error:
          "Dartsee could not verify this lane. Check the machine and refresh before trying again.",
        code: "DARTSEE_FEED_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "session-unavailable") {
    return privateJson(
      {
        error:
          "Dartsee could not verify the active session details needed to add time. Refresh and check the machine.",
        code: "DARTSEE_SESSION_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "shared-session") {
    return privateJson(
      {
        error:
          "This session spans multiple dart lanes. Adjust that linked session from the Dartsee machine so every lane stays together.",
        code: "DARTSEE_SHARED_SESSION",
      },
      409,
    );
  }
  if (code === "lane-state-changed") {
    return privateJson(
      {
        error:
          "This lane changed while it was being checked. Refresh the lanes and try again.",
        code: "DARTSEE_LANE_STATE_CHANGED",
      },
      409,
    );
  }
  if (code === "control-rejected") {
    return privateJson(
      {
        error:
          "Dartsee rejected the override request. Check the lane and refresh.",
        code: "DARTSEE_CONTROL_REJECTED",
      },
      502,
    );
  }
  return privateJson(
    {
      error:
        "Dartsee lane controls are unavailable. Check the Dartsee machine and Central service.",
      code: "DARTSEE_CONTROL_UNAVAILABLE",
    },
    503,
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return privateJson(
      {
        error: "Cross-origin override requests are not allowed.",
        code: "CROSS_ORIGIN_REQUEST",
      },
      403,
    );
  }
  if (!verifyStaffHeaderSecret(request)) {
    return privateJson({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return privateJson(
      { error: "Invalid override request.", code: "INVALID_OVERRIDE_REQUEST" },
      400,
    );
  }
  const parsed = overrideSchema.safeParse(payload);
  if (!parsed.success) {
    return privateJson(
      { error: "Invalid override request.", code: "INVALID_OVERRIDE_REQUEST" },
      400,
    );
  }

  try {
    const result = await overrideDartseeLaneSession(parsed.data);
    if (!result.ok) return failureResponse(result.code);
    if (!result.confirmed) {
      scheduleBackgroundWork(refreshDartseeLaneSnapshotAfterControl);
      return privateJson(
        {
          ok: true,
          action: result.action,
          confirmed: false,
          checkedAt: result.checkedAt,
          expectedSessionId: result.expectedSessionId,
          expectedSessionEnd: result.expectedSessionEnd,
          code: "OVERRIDE_UNCONFIRMED",
          message:
            result.action === "extend"
              ? "The added time may have been sent. Do not submit it again; check the lane while its timer refreshes."
              : "The start may have been sent. Do not submit it again; check the lane while its status refreshes.",
        },
        202,
      );
    }
    if (result.lane) {
      const confirmedAtMs = new Date(result.checkedAt).getTime();
      scheduleBackgroundWork(() =>
        publishConfirmedDartseeStart(result.lane!, confirmedAtMs),
      );
    }
    return privateJson({
      ok: true,
      action: result.action,
      confirmed: true,
      checkedAt: result.checkedAt,
      code: result.action === "extend" ? "EXTENDED" : "STARTED",
      lane: result.lane,
      snapshot: result.snapshot,
    });
  } catch {
    console.error("[dartsee lane:override] unhandled control failure");
    return privateJson(
      {
        error: "Dartsee lane controls are unavailable.",
        code: "DARTSEE_CONTROL_UNAVAILABLE",
      },
      503,
    );
  }
}
