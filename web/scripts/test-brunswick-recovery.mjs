#!/usr/bin/env node
import assert from "node:assert/strict";

import { detectScreenState } from "./brunswick-screen-state.mjs";

function observation(text, overrides = {}) {
  return {
    text,
    confidence: 0.99,
    x: 0.5,
    y: 0.5,
    width: 0.1,
    height: 0.02,
    ...overrides,
  };
}

function assertState(name, observations, expected, options) {
  assert.equal(detectScreenState(observations, options), expected, name);
}

assertState(
  "recognizes the normal Windows secure-attention prompt",
  [observation("Press Ctrl+Alt+Delete to unlock.")],
  "windows-lock",
);

assertState(
  "recognizes the actual mangled Vision OCR lock prompt",
  [observation("Press cultAIttUelete to unlock.")],
  "windows-lock",
);

const promptOmittedLockScreen = [
  observation("remotedesktop.google.com/access/session/abc123", {
    y: 0.97,
  }),
  observation("8:53", { y: 0.25, height: 0.085 }),
  observation("Wednesday, September 2", { y: 0.17, height: 0.025 }),
];
assertState(
  "recognizes a prompt-omitted lock screen by session URL, large clock, and date",
  promptOmittedLockScreen,
  "windows-lock",
);

assertState(
  "does not treat an ordinary timer and date as a Windows lock screen",
  [
    observation("8:53", { y: 0.25, height: 0.085 }),
    observation("Wednesday, September 2"),
  ],
  "unknown",
);

assertState(
  "requires a large lower-screen clock for the prompt-omitted fallback",
  [
    observation("remotedesktop.google.com/access/session/abc123", { y: 0.97 }),
    observation("0:42", { y: 0.72, height: 0.018 }),
    observation("Wednesday, September 2"),
  ],
  "unknown",
);

assertState(
  "preserves live feed precedence over lock-screen-shaped browser text",
  [
    ...promptOmittedLockScreen,
    observation("Bowling"),
    observation("Lane 1"),
    observation("Lane 2"),
  ],
  "feed",
);

assertState(
  "preserves the Owner password state",
  [observation("Owner"), observation("Password")],
  "windows-owner-login",
);

assertState(
  "preserves the Owner selection state",
  [observation("Owner")],
  "windows-owner-select",
);

assertState(
  "routes the Brunswick OFFICE LOGIN screen back to the desktop",
  [observation("OFFICE LOGIN"), observation("User"), observation("Password")],
  "brunswick-office",
);

assertState(
  "routes a restored Brunswick Office dashboard back to the desktop",
  [
    observation("Office_1 on SYNCSERVER"),
    observation("System Analysis"),
    observation("Nightly Tasks"),
  ],
  "brunswick-office",
);

assertState(
  "recognizes an explicit DESK LOGIN screen",
  [observation("DESK LOGIN"), observation("User"), observation("Password")],
  "brunswick-login",
);

assertState(
  "uses the active Desk launch deadline when OCR misses the tiny title",
  [observation("User"), observation("Password")],
  "brunswick-login",
  { nowMs: 10_000, deskLaunchExpectedUntil: 10_001 },
);

assertState(
  "does not submit credentials to an unidentified login after Desk grace expires",
  [observation("User"), observation("Password")],
  "unknown",
  { nowMs: 10_000, deskLaunchExpectedUntil: 10_000 },
);

assertState(
  "preserves an active Windows boot deadline",
  [],
  "windows-booting",
  { nowMs: 10_000, windowsBootExpectedUntil: 10_001 },
);

assertState(
  "recognizes the actual Windows desktop when OCR omits the Desk label",
  [
    observation("remotedesktop.google.com/access/session/abc123"),
    observation("Office"),
    observation("Recycle Bin"),
    observation("Brunswick Kemote"),
    observation("Support"),
    observation("BLS-2023"),
  ],
  "remote-desktop",
);

assertState(
  "preserves an active Desk launch deadline",
  [],
  "desk-starting",
  { nowMs: 10_000, deskLaunchExpectedUntil: 10_001 },
);

assertState(
  "does not preserve expired recovery deadlines",
  [],
  "unknown",
  {
    nowMs: 10_000,
    windowsBootExpectedUntil: 10_000,
    deskLaunchExpectedUntil: 9_999,
  },
);

console.log("Brunswick recovery screen-state tests passed (17 assertions).");
