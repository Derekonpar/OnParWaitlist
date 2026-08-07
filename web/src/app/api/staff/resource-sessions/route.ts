import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import {
  clearTimedResourceSession,
  getTimedResourceSessions,
  saveTimedResourceSession,
  TIMED_RESOURCES,
} from "@/lib/resource-sessions";
import { getEntertainmentSchedule } from "@/lib/entertainment-schedule";
import {
  reservationConflictsWithSession,
  timedResourceReservationIds,
} from "@/lib/reservation-policy";

export const dynamic = "force-dynamic";

const resourceTypeSchema = z.enum(["pool", "shuffleboard"]);
const resourceSchema = z
  .object({
    resourceType: resourceTypeSchema,
    resourceId: z.string(),
  })
  .refine(
    (value) =>
      TIMED_RESOURCES[value.resourceType].some(
        (resource) => resource.id === value.resourceId,
      ),
    { message: "Invalid resource" },
  );

const saveSchema = resourceSchema.and(
  z.object({
    guestName: z.string().trim().min(1).max(80),
    startsAt: z.string().datetime(),
    durationMinutes: z.union([z.literal(60), z.literal(120)]),
  }),
);

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ sessions: await getTimedResourceSessions() });
  } catch (error) {
    console.error("[resource sessions:read]", error);
    return NextResponse.json(
      { error: "Could not load resource sessions" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const parsed = saveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }
    const startMs = new Date(parsed.data.startsAt).getTime();
    const endMs = startMs + parsed.data.durationMinutes * 60_000;
    const resourceIds = timedResourceReservationIds(
      parsed.data.resourceType,
      parsed.data.resourceId,
    );
    const schedule = await getEntertainmentSchedule();
    const conflict = schedule?.reservations.find(
      (reservation) =>
        resourceIds.includes(reservation.resourceId.toLowerCase()) &&
        reservationConflictsWithSession(reservation, startMs, endMs),
    );
    if (conflict) {
      return NextResponse.json(
        {
          error: `This resource is protected starting one hour before the ${conflict.eventName} reservation.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      session: await saveTimedResourceSession(parsed.data),
    });
  } catch (error) {
    console.error("[resource sessions:save]", error);
    return NextResponse.json(
      { error: "Could not save session" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const parsed = resourceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
    }
    await clearTimedResourceSession(
      parsed.data.resourceType,
      parsed.data.resourceId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[resource sessions:clear]", error);
    return NextResponse.json(
      { error: "Could not clear session" },
      { status: 500 },
    );
  }
}
