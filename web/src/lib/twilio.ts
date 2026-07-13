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

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (await isSmsOptedOut(to)) {
    console.warn("[twilio] Skipped — number opted out:", to);
    return false;
  }

  const client = getClient();
  const from = readEnv("TWILIO_PHONE_NUMBER");
  if (!client || !from) {
    console.warn("[twilio] Missing credentials — SMS not sent:", { to, body });
    return false;
  }

  try {
    await client.messages.create({ to, from, body });
    return true;
  } catch (err) {
    console.error("[twilio] Send failed:", err);
    return false;
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
