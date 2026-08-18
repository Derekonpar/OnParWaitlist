import { after, NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffHeaderSecret } from "@/lib/auth";
import {
  publishConfirmedDartseeStart,
  refreshDartseeLaneSnapshotAfterControl,
  startDartseeLaneSession,
  type DartseeLaneStartFailureCode,
} from "@/lib/dartsee-lanes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startSchema = z
  .object({
    requestId: z.string().uuid(),
    lane: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    durationMinutes: z.union([
      z.literal(30),
      z.literal(60),
      z.literal(120),
    ]),
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
    // A missing request waitUntil must never turn an already-issued physical
    // control into an error response. Normal lane polling remains the fallback.
    console.warn("[dartsee lane:start] background refresh unavailable");
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function failureResponse(
  code: DartseeLaneStartFailureCode,
  conflict?: { eventName: string; startAt: string },
) {
  if (code === "already-in-progress") {
    return privateJson(
      {
        error: "A start is already being checked for this lane.",
        code: "START_ALREADY_IN_PROGRESS",
      },
      409,
    );
  }
  if (code === "schedule-unavailable") {
    return privateJson(
      {
        error:
          "Reservation protection is updating. Refresh the schedule before starting this lane.",
        code: "SCHEDULE_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "reservation-conflict") {
    return privateJson(
      {
        error: conflict
          ? `This time overlaps the protection window starting 1 hour 5 minutes before ${conflict.eventName}.`
          : "This time overlaps a protected reservation.",
        code: "RESERVATION_CONFLICT",
      },
      409,
    );
  }
  if (code === "lane-occupied") {
    return privateJson(
      { error: "This dart lane is already in use.", code: "LANE_OCCUPIED" },
      409,
    );
  }
  if (code === "feed-unavailable") {
    return privateJson(
      {
        error:
          "Dartsee could not confirm that this lane is open. Check the machine and refresh before trying again.",
        code: "DARTSEE_FEED_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "control-rejected") {
    return privateJson(
      {
        error: "Dartsee rejected the start request. Check the lane and try again.",
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
      { error: "Cross-origin start requests are not allowed.", code: "CROSS_ORIGIN_REQUEST" },
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
      { error: "Invalid start request.", code: "INVALID_START_REQUEST" },
      400,
    );
  }
  const parsed = startSchema.safeParse(payload);
  if (!parsed.success) {
    return privateJson(
      { error: "Invalid start request.", code: "INVALID_START_REQUEST" },
      400,
    );
  }

  try {
    const result = await startDartseeLaneSession(parsed.data);
    if (!result.ok) return failureResponse(result.code, result.conflict);
    if (!result.confirmed) {
      scheduleBackgroundWork(refreshDartseeLaneSnapshotAfterControl);
      return privateJson(
        {
          ok: true,
          confirmed: false,
          checkedAt: result.checkedAt,
          code: "START_UNCONFIRMED",
          message:
            "The start may have been sent. Do not click Start again; check the lane while its status refreshes.",
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
      confirmed: true,
      checkedAt: result.checkedAt,
      code: "STARTED",
      lane: result.lane,
      snapshot: result.snapshot,
    });
  } catch (error) {
    console.error("[dartsee lane:start]", error);
    return privateJson(
      {
        error: "Dartsee lane controls are unavailable.",
        code: "DARTSEE_CONTROL_UNAVAILABLE",
      },
      503,
    );
  }
}
