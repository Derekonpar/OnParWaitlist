import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import {
  clearTimedResourceSession,
  getTimedResourceSessions,
  saveTimedResourceSession,
  TIMED_RESOURCES,
} from "@/lib/resource-sessions";

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
