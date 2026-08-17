import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const twilioSource = readFileSync(
  new URL("../src/lib/twilio.ts", import.meta.url),
  "utf8",
);
const joinSource = readFileSync(
  new URL("../src/app/api/waitlist/join/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  twilioSource,
  /timeout:\s*TWILIO_HTTP_TIMEOUT_MS/,
  "Twilio requests must use the bounded client timeout",
);
assert.match(
  twilioSource,
  /autoRetry:\s*false/,
  "SMS sends must not introduce automatic retries",
);
assert.match(
  twilioSource,
  /options\.optOutCheck\s*!==\s*["']already-checked["'][\s\S]*?isSmsOptedOut\(to\)/,
  "sendSms must enforce opt-out status unless the caller already checked it",
);
assert.match(
  joinSource,
  /isSmsOptedOut\(phone\)[\s\S]*?sendSms\([\s\S]*?optOutCheck:\s*["']already-checked["']/,
  "Guest join must check opt-out status once before using the already-checked send path",
);
assert.match(
  joinSource,
  /recordSmsAttempt\(entry\.id,\s*["']join["'],\s*sms\)/,
  "Guest join must continue recording every SMS attempt",
);

console.log("Guest join SMS reliability regression test passed.");
