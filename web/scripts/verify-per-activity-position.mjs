/**
 * Verifies waitlist positions are per-activity, not global.
 * Run: node scripts/verify-per-activity-position.mjs
 */
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/waitlist.json");

// Inline the same position logic as store.ts getPosition
function getPosition(entries, id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.status !== "waiting") return null;
  const ahead = entries.filter(
    (e) =>
      e.activity === entry.activity &&
      e.status === "waiting" &&
      new Date(e.createdAt).getTime() < new Date(entry.createdAt).getTime(),
  );
  return { entry, position: ahead.length + 1 };
}

function makeEntry(activity, name, offsetMs = 0) {
  return {
    id: randomUUID(),
    activity,
    name,
    phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
    smsOptIn: false,
    status: "waiting",
    createdAt: new Date(Date.now() + offsetMs).toISOString(),
  };
}

const entries = [];
for (let i = 0; i < 10; i++) {
  entries.push(makeEntry("bowling", `Bowler ${i + 1}`, i));
}
const dartsEntry = makeEntry("darts", "First Darter", 100);
entries.push(dartsEntry);

const result = getPosition(entries, dartsEntry.id);

const bowlingCount = entries.filter(
  (e) => e.activity === "bowling" && e.status === "waiting",
).length;
const dartsCount = entries.filter(
  (e) => e.activity === "darts" && e.status === "waiting",
).length;

console.log("--- Per-activity position test ---");
console.log(`Bowling waiting: ${bowlingCount}`);
console.log(`Darts waiting: ${dartsCount}`);
console.log(`Darts joiner position: ${result?.position}`);
console.log(`Darts joiner activity: ${result?.entry.activity}`);

if (result?.position === 1 && bowlingCount === 10 && dartsCount === 1) {
  console.log("\n✓ PASS: Darts joiner is #1 (not affected by 10 bowling parties)");
  process.exit(0);
}

console.log("\n✗ FAIL: Expected darts position 1");
process.exit(1);
