/**
 * FIFO waitlist estimate checks.
 * Run: node scripts/test-wait-estimate.mjs
 */

function fifoWaitMinutes(parties) {
  return parties.reduce((sum, entry) => sum + entry.sessionMinutes, 0);
}

function assert(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`OK ${label}`);
}

// First guest: nobody ahead → 0 min
assert("first in line", fifoWaitMinutes([]), 0);

// Darts: 2 lanes for 1 hour ahead → next guest waits full hour (not 0)
assert(
  "darts 2 lanes 1hr ahead blocks next guest",
  fifoWaitMinutes([{ sessionMinutes: 60 }]),
  60,
);

// Two parties ahead at 60 min each → 120 min
assert(
  "two hour-long parties ahead",
  fifoWaitMinutes([{ sessionMinutes: 60 }, { sessionMinutes: 60 }]),
  120,
);

// Pool: 2 tables 30 min does not divide — still 30 min for person behind
assert(
  "pool multi-table still full session wait",
  fifoWaitMinutes([{ sessionMinutes: 30 }]),
  30,
);

// Shuffleboard: 2 lanes 2 hours ahead
assert(
  "shuffleboard 2hr session ahead",
  fifoWaitMinutes([{ sessionMinutes: 120 }]),
  120,
);

// Bowling: 2 lanes 1 hour ahead
assert(
  "bowling 2 lanes 1hr ahead",
  fifoWaitMinutes([{ sessionMinutes: 60 }]),
  60,
);

console.log("\nALL WAIT ESTIMATE TESTS PASSED");
