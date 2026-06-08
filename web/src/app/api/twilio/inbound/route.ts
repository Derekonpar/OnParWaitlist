import { NextResponse } from "next/server";
import { addSmsOptOut, removeSmsOptOut } from "@/lib/sms-consent";
import { getVenueName } from "@/lib/venue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

const START_KEYWORDS = new Set(["START", "UNSTOP"]);

function twiml(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const from = form.get("From")?.toString() ?? "";
  const body = (form.get("Body")?.toString() ?? "").trim().toUpperCase();
  const venue = getVenueName();

  if (!from) {
    return new NextResponse(twiml("Invalid request."), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  if (STOP_KEYWORDS.has(body)) {
    await addSmsOptOut(from);
    return new NextResponse(
      twiml(
        `${venue}: You are unsubscribed from waitlist texts. No more messages will be sent. Reply START to resubscribe.`,
      ),
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  if (START_KEYWORDS.has(body)) {
    await removeSmsOptOut(from);
    return new NextResponse(
      twiml(
        `${venue}: You have resubscribed to waitlist texts. Join a waitlist at our venue and opt in to receive messages.`,
      ),
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  if (body === "HELP" || body === "INFO") {
    return new NextResponse(
      twiml(
        `${venue} waitlist alerts. Msg frequency varies. Msg&data rates may apply. Reply STOP to cancel. Help: visit our SMS page on the waitlist site.`,
      ),
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  return new NextResponse("", { status: 204 });
}
