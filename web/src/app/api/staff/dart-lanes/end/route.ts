import { after, NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffHeaderSecret } from "@/lib/auth";
import {
  endDartseeLaneSession,
  publishConfirmedDartseeEnd,
  refreshDartseeLaneSnapshotAfterControl,
  type DartseeLaneEndFailureCode,
} from "@/lib/dartsee-lanes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const endSchema = z
  .object({
    requestId: z.string().uuid(),
    lane: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
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
    console.warn("[dartsee lane:end] background refresh unavailable");
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function failureResponse(code: DartseeLaneEndFailureCode) {
  if (code === "already-in-progress") {
    return privateJson(
      {
        error: "This dart lane is already being checked.",
        code: "DART_CONTROL_ALREADY_IN_PROGRESS",
      },
      409,
    );
  }
  if (code === "lane-open") {
    return privateJson(
      { error: "This dart lane is already open.", code: "LANE_OPEN" },
      409,
    );
  }
  if (code === "feed-unavailable" || code === "session-unavailable") {
    return privateJson(
      {
        error:
          "Dartsee could not verify the active session. Check the machine and refresh before trying again.",
        code: "DARTSEE_SESSION_UNAVAILABLE",
      },
      503,
    );
  }
  if (code === "shared-session") {
    return privateJson(
      {
        error:
          "This session spans multiple dart lanes. End the group from the Dartsee machine so every linked lane is handled together.",
        code: "DARTSEE_SHARED_SESSION",
      },
      409,
    );
  }
  if (code === "control-rejected") {
    return privateJson(
      {
        error: "Dartsee rejected the End request. Check the lane and refresh.",
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
        error: "Cross-origin End requests are not allowed.",
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
      { error: "Invalid End request.", code: "INVALID_END_REQUEST" },
      400,
    );
  }
  const parsed = endSchema.safeParse(payload);
  if (!parsed.success) {
    return privateJson(
      { error: "Invalid End request.", code: "INVALID_END_REQUEST" },
      400,
    );
  }

  try {
    const result = await endDartseeLaneSession(parsed.data);
    if (!result.ok) return failureResponse(result.code);
    if (!result.confirmed) {
      scheduleBackgroundWork(refreshDartseeLaneSnapshotAfterControl);
      return privateJson(
        {
          ok: true,
          confirmed: false,
          checkedAt: result.checkedAt,
          code: "END_UNCONFIRMED",
          message:
            "The End command may have been sent. Do not click End again; check the lane while its status refreshes.",
        },
        202,
      );
    }
    if (result.lane) {
      const confirmedAtMs = new Date(result.checkedAt).getTime();
      scheduleBackgroundWork(() =>
        publishConfirmedDartseeEnd(result.lane!, confirmedAtMs),
      );
    }
    return privateJson({
      ok: true,
      confirmed: true,
      checkedAt: result.checkedAt,
      code: "ENDED",
      lane: result.lane,
      snapshot: result.snapshot,
    });
  } catch {
    console.error("[dartsee lane:end] unhandled control failure");
    return privateJson(
      {
        error: "Dartsee lane controls are unavailable.",
        code: "DARTSEE_CONTROL_UNAVAILABLE",
      },
      503,
    );
  }
}
