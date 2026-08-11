import twilio from "twilio";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readEnv } from "@/lib/env";
import { recordSmsDelivery } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  entryId: z.string().uuid(),
  kind: z.enum(["join", "notify", "update"]),
});

export async function POST(request: Request) {
  const token = readEnv("TWILIO_AUTH_TOKEN");
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!token || !signature) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    entryId: url.searchParams.get("entryId"),
    kind: url.searchParams.get("kind"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  if (!twilio.validateRequest(token, signature, request.url, params)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messageSid = params.MessageSid ?? params.SmsSid;
  const status = (params.MessageStatus ?? params.SmsStatus ?? "unknown").toLowerCase();
  if (!messageSid) {
    return NextResponse.json({ error: "Missing message SID" }, { status: 400 });
  }

  await recordSmsDelivery(messageSid, status, params.ErrorCode || undefined);
  return new NextResponse(null, { status: 204 });
}
