import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const board = readFileSync(
  new URL("../src/components/TvWaitBoard.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(board, /Walk on/i, "Zero-minute live activities must not say Walk On");
assert.match(board, />\s*No Wait\s*</, "Zero-minute live activities must say No Wait");
assert.match(board, /Mini Golf/, "The TV board must include Mini Golf");
assert.match(board, /Karaoke/, "The TV board must include Karaoke");
const karaokeCard = board.match(
  /<article className="[^"]*from-violet-950[^"]*">[\s\S]*?<\/article>/,
)?.[0];
assert.ok(karaokeCard, "The Karaoke status card must be present");
assert.match(
  karaokeCard,
  />\s*Wait\s*</,
  "Karaoke must show the approved fixed Wait status",
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
  /aria-label="Additional entertainment and waitlist signup"/,
  "The compact bottom band must be labeled for accessibility",
);

console.log("TV wait board content regression test passed.");
