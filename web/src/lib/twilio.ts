import twilio from "twilio";
import { isSmsOptedOut } from "./sms-consent";

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (await isSmsOptedOut(to)) {
    console.warn("[twilio] Skipped — number opted out:", to);
    return false;
  }

  const client = getClient();
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!client || !from) {
    console.warn("[twilio] Missing credentials — SMS not sent:", { to, body });
    return false;
  }

  await client.messages.create({ to, from, body });
  return true;
}

export function buildReadyMessage(
  name: string,
  activityLabel: string,
): string {
  const venue = process.env.VENUE_NAME ?? "On Par Entertainment";
  return `Hi ${name}! You're up for ${activityLabel} at ${venue}. Please check in at the front desk within 5 minutes. Reply STOP to opt out.`;
}

export function buildJoinConfirmation(
  name: string,
  activityLabel: string,
  position: number,
): string {
  const venue = process.env.VENUE_NAME ?? "On Par Entertainment";
  return `Thanks ${name}! You're #${position} on the ${activityLabel} waitlist at ${venue}. We'll text you when it's your turn. Reply STOP to opt out.`;
}
