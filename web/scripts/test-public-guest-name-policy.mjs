import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validatePublicGuestName } from "../src/lib/public-guest-name-policy.ts";

const accepted = [
  ["José", "O’Neill"],
  ["María-José", "De La Cruz"],
  ["Nguyễn", "Thị"],
  ["Dick", "Van Dyke"],
  ["Taylor", "Smith Jr."],
];

const rejected = [
  ["F.U.C.K", "Face"],
  ["F u c k", "Face"],
  ["Fuuuck", "Face"],
  ["Sh1t", "Head"],
  ["Normal", "😀"],
  ["F\u200buck", "Face"],
  ["Fоck", "Face"], // Cyrillic "o" mixed into Latin text.
  ["Bitch", "Please"],
];

for (const [firstName, lastName] of accepted) {
  assert.equal(
    validatePublicGuestName(firstName, lastName).ok,
    true,
    `Expected a legitimate name to pass: ${firstName} ${lastName}`,
  );
}

for (const [firstName, lastName] of rejected) {
  assert.equal(
    validatePublicGuestName(firstName, lastName).ok,
    false,
    "Expected an inappropriate or malformed guest name to be rejected",
  );
}

const joinRoute = readFileSync(
  new URL("../src/app/api/waitlist/join/route.ts", import.meta.url),
  "utf8",
);
const staffAddRoute = readFileSync(
  new URL("../src/app/api/staff/add/route.ts", import.meta.url),
  "utf8",
);

const policyCall = joinRoute.indexOf("validatePublicGuestName(firstName, lastName)");
assert.ok(policyCall >= 0, "The public join route must call the guest-name policy");
assert.ok(
  policyCall < joinRoute.indexOf("isSmsOptedOut(phone)"),
  "Name rejection must happen before opt-out storage work",
);
assert.ok(
  policyCall < joinRoute.indexOf("await joinWaitlist({"),
  "Name rejection must happen before any waitlist write",
);
assert.match(
  joinRoute,
  /code:\s*["']INVALID_GUEST_NAME["']/,
  "The public route must return a stable invalid-name code",
);
assert.doesNotMatch(
  staffAddRoute,
  /public-guest-name-policy|validatePublicGuestName/,
  "Authenticated staff entry must remain the false-positive override path",
);

console.log("Public guest name policy regression test passed.");
