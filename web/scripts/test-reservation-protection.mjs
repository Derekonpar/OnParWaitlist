import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/reservation-policy.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const policy = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const reservationStartMs = Date.parse("2026-08-18T18:00:00.000Z");
const reservation = {
  startAt: new Date(reservationStartMs).toISOString(),
  endAt: new Date(reservationStartMs + 60 * 60 * 1000).toISOString(),
};
const protectionStartsMs = reservationStartMs - 65 * 60 * 1000;

assert.equal(
  policy.RESERVATION_PROTECTION_MS,
  65 * 60 * 1000,
  "All entertainment must use a 65-minute reservation protection window",
);
assert.equal(
  policy.reservationProtectionActive(reservation, protectionStartsMs - 1),
  false,
  "Protection must remain inactive until the 65-minute boundary",
);
assert.equal(
  policy.reservationProtectionActive(reservation, protectionStartsMs),
  true,
  "Protection must activate exactly 65 minutes before a reservation",
);
assert.equal(
  policy.reservationConflictsWithSession(
    reservation,
    protectionStartsMs - 30 * 60 * 1000,
    protectionStartsMs,
  ),
  false,
  "A session ending exactly at the protection boundary must remain allowable",
);
assert.equal(
  policy.reservationConflictsWithSession(
    reservation,
    protectionStartsMs - 30 * 60 * 1000,
    protectionStartsMs + 1,
  ),
  true,
  "A session extending beyond the protection boundary must be rejected",
);
assert.doesNotMatch(
  source,
  /override/i,
  "The shared reservation policy must remain authoritative; override belongs only to the staff Dart Start caller",
);
const reservationEndMs = Date.parse(reservation.endAt);
assert.equal(
  policy.reservationConflictsWithSession(
    reservation,
    reservationStartMs,
    reservationStartMs + 30 * 60 * 1000,
  ),
  true,
  "A normal Start during an active reservation must remain blocked",
);
assert.equal(
  policy.reservationConflictsWithSession(
    reservation,
    reservationEndMs,
    reservationEndMs + 60 * 60 * 1000,
  ),
  false,
  "The reservation must stop blocking exactly at its end",
);

console.log("65-minute reservation protection regression test passed.");
