import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

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
assert.match(
  board,
  /label="Public Karaoke"/,
  "The TV board must label the Main Stage as Public Karaoke",
);
assert.match(
  board,
  /fetch\("\/api\/karaoke\/public-stage"/,
  "The Karaoke card must read the sanitized same-origin Singa endpoint",
);
assert.match(
  board,
  /karaokeRefreshController/,
  "Singa must use a controller independent from the four-activity board",
);
assert.match(
  board,
  /window\.setInterval\([\s\S]*?refreshKaraoke\(\)[\s\S]*?30_000/,
  "The Singa status must refresh no faster than every 30 seconds",
);
assert.match(
  board,
  /document\.hidden/,
  "The Singa poll must pause while the TV page is hidden",
);
assert.match(
  board,
  /"Not Open"/,
  "An inactive Singa session after closing must show Not Open",
);
assert.match(
  board,
  /karaokeInactiveDisplayStatus\(nowMs\)/,
  "The Karaoke card must use the New York operating-hours policy",
);
assert.match(
  board,
  /karaokeInactiveNoWait[\s\S]*?"No Wait"[\s\S]*?karaokeNotOpen[\s\S]*?"Not Open"/,
  "Inactive Karaoke must show No Wait before closing and Not Open after closing",
);
assert.match(
  board,
  /karaokeActive =\s*karaokeWithinDisplayHours && karaokeWait\?\.status === "active"/,
  "Closing time must override even a stale upstream active signal",
);
assert.match(
  board,
  /: karaokeWait \? \(\s*"Updating"\s*\) : \(\s*"Connecting"/,
  "An unavailable Singa response must keep showing Updating rather than No Wait",
);
assert.match(
  board,
  /detail="Private karaoke rooms: No Wait"/,
  "The Karaoke card footer must advertise no wait on private rooms",
);
assert.doesNotMatch(
  board,
  /detail="Hosted rotation"/,
  "Karaoke must no longer use the fixed placeholder status",
);
assert.equal(
  (board.match(/<TvWaitDuration /g) ?? []).length,
  2,
  "All four activity cards and Karaoke must share the TV wait-duration formatter",
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
assert.ok(
  existsSync(new URL("../public/images/on-par-logo-full.png", import.meta.url)),
  "The supplied On Par logo asset must be present",
);
assert.match(
  board,
  /src="\/images\/on-par-logo-full\.png"/,
  "The QR panel must display the supplied On Par logo",
);
assert.match(
  board,
  /on-par-logo-full\.png[\s\S]*?className="[^"]*\binvert\b/,
  "The supplied black-and-white logo must be color-inverted on the dark panel",
);
assert.doesNotMatch(
  board,
  /on-par-logo-full\.png[\s\S]*?className="[^"]*brightness-0/,
  "The logo must not be flattened to a solid white silhouette",
);
assert.ok(
  board.indexOf('src="/images/on-par-logo-full.png"') <
    board.indexOf('src="/waitlist-qr.png"'),
  "The On Par logo must appear above the waitlist QR code",
);
assert.match(board, /queue\.slice\(0, 4\)/, "The TV card must show at most four guest names");
assert.match(board, /\{person\.position\}/, "Each displayed guest must include their queue number");
assert.match(board, /\{person\.name\}/, "Each displayed queue row must include the guest name");
assert.match(
  board,
  /min-h-\[clamp\(2\.25rem,4\.6vh,2\.75rem\)\]/,
  "Each guest row must be tall enough to read from across the room",
);
assert.match(
  board,
  /text-\[clamp\(1rem,1\.35vw,1\.5rem\)\] font-black/,
  "TV guest names must use the larger high-contrast type treatment",
);
assert.match(board, /queue=\{queue\}/, "Live entertainment cards must receive their queue preview");
assert.ok(
  board.indexOf("data-tv-queue-preview") < board.indexOf("data-tv-wait-summary"),
  "Guest names must appear above the estimated-wait block",
);
assert.match(
  board,
  /data-tv-wait-summary[\s\S]*?className="mt-auto shrink-0/,
  "The estimated-wait block must remain anchored at the bottom",
);
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
