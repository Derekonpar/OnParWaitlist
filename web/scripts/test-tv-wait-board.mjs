import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(
  new URL("../src/components/TvWaitBoard.tsx", import.meta.url),
  "utf8",
);
const customerCard = readFileSync(
  new URL("../src/components/ActivityCard.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(board, /Walk on/i, "Zero-minute live activities must not say Walk On");
assert.match(board, /["']No Wait["']/, "Zero-minute live activities must say No Wait");
assert.match(board, /Mini Golf/, "The TV board must include Mini Golf");
assert.match(board, /Karaoke/, "The TV board must include Karaoke");
const karaokeCard = board.match(
  /<EntertainmentCard\s+[\s\S]*?label="Karaoke"[\s\S]*?detail="Hosted rotation"[\s\S]*?\/>/,
)?.[0];
assert.ok(karaokeCard, "The Karaoke status card must be present");
assert.match(
  karaokeCard,
  /status="No Wait"/,
  "Karaoke must show the approved fixed No Wait status",
);
assert.match(
  board,
  /Updating · showing last known/,
  "The TV clock must identify last-known data during a live refresh failure",
);
assert.match(
  board,
  /availabilityStatus === "live"/,
  "The TV board must not label unknown live-feed availability as No Wait",
);
assert.doesNotMatch(
  customerCard,
  /Walk on/i,
  "Customer signup cards must not use Walk On wording",
);
assert.match(
  customerCard,
  /No Wait/,
  "Customer signup cards must use No Wait for zero-minute waits",
);
assert.match(board, /src="\/waitlist-qr\.png"/, "The TV board must display the waitlist QR code");
assert.match(
  board,
  /Put yourself on the waitlist/i,
  "The QR call to action must tell guests to put themselves on the waitlist",
);
assert.match(board, /onparwaitlist\.com/, "The QR call to action must include the readable URL");
assert.match(
  board,
  /function EntertainmentCard/,
  "All entertainment statuses must share one equal-size card component",
);
assert.equal(
  (board.match(/<EntertainmentCard/g) ?? []).length,
  3,
  "The shared card must render the four live activities plus Mini Golf and Karaoke",
);
assert.match(
  board,
  /grid-cols-\[repeat\(3,minmax\(0,1fr\)\)_minmax\(20rem,0\.9fr\)\]/,
  "The TV layout must reserve three equal activity columns and one QR column",
);
assert.match(board, /row-span-2/, "The QR panel must span both entertainment rows");
assert.match(board, /width=\{240\}/, "The QR image must be substantially larger for scanning");

console.log("TV wait board content regression test passed.");
