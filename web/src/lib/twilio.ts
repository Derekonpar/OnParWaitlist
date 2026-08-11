import twilio from "twilio";
import { isSmsOptedOut } from "./sms-consent";
import { smsFirstName } from "./names";
import { readEnv } from "./env";

function getClient() {
  const sid = readEnv("TWILIO_ACCOUNT_SID");
  const token = readEnv("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export interface SmsSendResult {
  accepted: boolean;
  sid?: string;
  status: string;
  errorCode?: string;
}

export async function sendSms(
  to: string,
  body: string,
  statusCallback?: string,
): Promise<SmsSendResult> {
  if (await isSmsOptedOut(to)) {
    console.warn("[twilio] Skipped — number opted out");
    return { accepted: false, status: "failed", errorCode: "21610" };
  }

  const client = getClient();
  const from = readEnv("TWILIO_PHONE_NUMBER");
  if (!client || !from) {
    console.warn("[twilio] Missing credentials — SMS not sent");
    return { accepted: false, status: "failed", errorCode: "CONFIGURATION" };
  }

  try {
    const message = await client.messages.create({
      to,
      from,
      body,
      ...(statusCallback ? { statusCallback } : {}),
    });
    return {
      accepted: true,
      sid: message.sid,
      status: message.status ?? "queued",
      errorCode: message.errorCode ? String(message.errorCode) : undefined,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code ?? "SEND_FAILED")
        : "SEND_FAILED";
    console.error("[twilio] Send failed", { code });
    return { accepted: false, status: "failed", errorCode: code };
  }
}

export function buildReadyMessage(
  name: string,
  activityLabel: string,
): string {
  const venue = readEnv("VENUE_NAME") ?? "On Par Entertainment";
  const first = smsFirstName(name);
  return `Hi ${first}! You're up for ${activityLabel} at ${venue}. Please check in at the front desk within 5 minutes. Reply STOP to opt out.`;
}

export function buildJoinConfirmation(
  name: string,
  activityLabel: string,
  position: number,
  statusUrl: string,
): string {
  const venue = readEnv("VENUE_NAME") ?? "On Par Entertainment";
  const first = smsFirstName(name);
  return `Thanks ${first}! You're #${position} on the ${activityLabel} waitlist at ${venue}. View your spot in line: ${statusUrl} We'll text you when it's your turn. Reply STOP to opt out.`;
}

export function buildWaitlistUpdate(
  name: string,
  activityLabel: string,
  bookingSummary: string,
  position: number,
  statusUrl: string,
): string {
  const venue = readEnv("VENUE_NAME") ?? "On Par Entertainment";
  const first = smsFirstName(name);
  return `Hi ${first}, your ${activityLabel} waitlist details at ${venue} were updated: ${bookingSummary}. You're #${position}. View your current status: ${statusUrl} Reply STOP to opt out.`;
}
