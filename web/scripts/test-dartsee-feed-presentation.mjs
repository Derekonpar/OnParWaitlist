import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DARTSEE_EMPLOYEE_ALERT_AFTER_MS,
  DARTSEE_SAFETY_STALE_AFTER_MS,
  DARTSEE_SUSTAINED_FAILURE_REFRESHES,
  dartseeLaneFeedPresentation,
} from "../src/lib/dartsee-feed-presentation.ts";

const healthy = {
  hasSnapshot: true,
  snapshotAgeMs: 0,
  healthStatus: "ok",
  consecutiveIncompleteRefreshes: 0,
  laneUnresponsive: false,
};

const cases = [
  {
    name: "fresh healthy lane",
    input: healthy,
    expected: { safetyUnavailable: false, tone: "normal" },
  },
  {
    name: "healthy lane at 59 seconds",
    input: { ...healthy, snapshotAgeMs: 59_000 },
    expected: { safetyUnavailable: false, tone: "normal" },
  },
  {
    name: "stale-for-safety lane at 61 seconds",
    input: { ...healthy, snapshotAgeMs: 61_000 },
    expected: { safetyUnavailable: true, tone: "refreshing" },
  },
  {
    name: "still refreshing just before five minutes",
    input: { ...healthy, snapshotAgeMs: 299_000 },
    expected: { safetyUnavailable: true, tone: "refreshing" },
  },
  {
    name: "actionable after five minutes",
    input: { ...healthy, snapshotAgeMs: 301_000 },
    expected: { safetyUnavailable: true, tone: "attention" },
  },
  {
    name: "first connection failure",
    input: {
      ...healthy,
      healthStatus: "connection-error",
      consecutiveIncompleteRefreshes: 1,
    },
    expected: { safetyUnavailable: true, tone: "refreshing" },
  },
  {
    name: "nineteenth connection failure",
    input: {
      ...healthy,
      healthStatus: "connection-error",
      consecutiveIncompleteRefreshes: 19,
    },
    expected: { safetyUnavailable: true, tone: "refreshing" },
  },
  {
    name: "twentieth connection failure",
    input: {
      ...healthy,
      healthStatus: "connection-error",
      consecutiveIncompleteRefreshes: 20,
    },
    expected: { safetyUnavailable: true, tone: "attention" },
  },
  {
    name: "transient unresponsive lane",
    input: {
      ...healthy,
      consecutiveIncompleteRefreshes: 19,
      laneUnresponsive: true,
    },
    expected: { safetyUnavailable: true, tone: "refreshing" },
  },
  {
    name: "sustained unresponsive lane",
    input: {
      ...healthy,
      healthStatus: "partial",
      consecutiveIncompleteRefreshes: 20,
      laneUnresponsive: true,
    },
    expected: { safetyUnavailable: true, tone: "attention" },
  },
  {
    name: "responding lane remains usable during a partial refresh",
    input: {
      ...healthy,
      healthStatus: "partial",
      consecutiveIncompleteRefreshes: 20,
    },
    expected: { safetyUnavailable: false, tone: "normal" },
  },
  {
    name: "authentication failure is immediately actionable",
    input: { ...healthy, healthStatus: "auth-error" },
    expected: { safetyUnavailable: true, tone: "attention" },
  },
  {
    name: "missing snapshot is immediately actionable",
    input: {
      ...healthy,
      hasSnapshot: false,
      snapshotAgeMs: Number.POSITIVE_INFINITY,
      healthStatus: null,
    },
    expected: { safetyUnavailable: true, tone: "attention" },
  },
];

for (const testCase of cases) {
  assert.deepEqual(
    dartseeLaneFeedPresentation(testCase.input),
    testCase.expected,
    testCase.name,
  );
}

assert.equal(DARTSEE_SAFETY_STALE_AFTER_MS, 60_000);
assert.equal(DARTSEE_EMPLOYEE_ALERT_AFTER_MS, 5 * 60_000);
assert.equal(DARTSEE_SUSTAINED_FAILURE_REFRESHES, 20);

const component = readFileSync(
  new URL("../src/components/DartsPlanner.tsx", import.meta.url),
  "utf8",
);
assert.match(component, /dartseeLaneFeedPresentation\(/);
assert.match(component, /feedPresentation\.safetyUnavailable/);
assert.match(component, /feedPresentation\.tone === "refreshing"/);
assert.match(component, /Status refreshing/);
assert.doesNotMatch(
  component,
  /role="alert"/,
  "The Darts tab must not duplicate the staff-wide red feed alert",
);

console.log("Dartsee feed presentation regression test passed.");
