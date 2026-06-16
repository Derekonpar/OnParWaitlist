/**
 * Quick checks for capacity-based wait estimates.
 * Run: node scripts/test-wait-estimate.mjs
 */

function assignParty(laneEnds, laneCount, sessionMinutes) {
  const capacity = laneEnds.length;
  const need = Math.min(Math.max(1, laneCount), capacity);
  const indexed = laneEnds
    .map((endAt, index) => ({ endAt, index }))
    .sort((a, b) => a.endAt - b.endAt);
  const startAt = indexed[need - 1].endAt;
  const endAt = startAt + sessionMinutes;
  for (let i = 0; i < need; i++) {
    laneEnds[indexed[i].index] = endAt;
  }
  return startAt;
}

function simulateWaitMinutes(capacity, partiesAhead, request) {
  const laneEnds = Array.from({ length: capacity }, () => 0);
  for (const party of partiesAhead) {
    assignParty(laneEnds, party.laneCount, party.sessionMinutes);
  }
  return Math.ceil(
    assignParty(laneEnds, request.laneCount, request.sessionMinutes),
  );
}

function assert(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`OK ${label}`);
}

assert(
  "pool 2 tables 60min leaves 1 table open",
  simulateWaitMinutes(
    3,
    [{ laneCount: 2, sessionMinutes: 60 }],
    { laneCount: 1, sessionMinutes: 30 },
  ),
  0,
);

assert(
  "pool full house blocks next guest",
  simulateWaitMinutes(
    3,
    [{ laneCount: 3, sessionMinutes: 30 }],
    { laneCount: 1, sessionMinutes: 30 },
  ),
  30,
);

assert(
  "shuffleboard 2 lanes 2 hours",
  simulateWaitMinutes(
    2,
    [{ laneCount: 2, sessionMinutes: 120 }],
    { laneCount: 1, sessionMinutes: 30 },
  ),
  120,
);

assert(
  "bowling multi-lane does not divide session",
  simulateWaitMinutes(
    12,
    [{ laneCount: 2, sessionMinutes: 60 }],
    { laneCount: 1, sessionMinutes: 30 },
  ),
  0,
);

assert(
  "darts 5 lanes fill sequentially",
  simulateWaitMinutes(
    5,
    Array.from({ length: 5 }, () => ({
      laneCount: 1,
      sessionMinutes: 30,
    })),
    { laneCount: 1, sessionMinutes: 30 },
  ),
  30,
);

console.log("\nALL WAIT ESTIMATE TESTS PASSED");
