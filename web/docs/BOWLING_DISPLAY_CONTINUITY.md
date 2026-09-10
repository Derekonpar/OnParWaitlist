# Bowling display continuity — September 10, 2026

## Contract

Brief source/OCR interruptions must not erase positively observed occupied
lanes or blank passive guest/TV estimates. The display grace is strictly less
than 180 seconds from the original source evidence. It is not extended by a
health update, a new API poll, a new frame of another lane, or a watcher restart.

The Luckfox watcher retains occupied evidence with `observedAt` and
`estimated: true`, decrementing from the original remaining time. An expired
countdown remains occupied, never open. Two separate current, clock-verified
open frames are required to clear occupancy. Unknown lanes without positive
evidence stay unknown. OCR confidence, crop geometry, and source-clock checks
are unchanged. The first two stabilized frames after reconnect are verified
before publishing, avoiding a pending-open startup flash.

The authenticated bowling snapshot API preserves the optional per-lane metadata;
its existing JSON lane storage needs no SQL migration. Legacy snapshots are
bounded by their original `capturedAt`. Health-only updates do not change it.

Only `getBoard()` opts into estimated availability. It still loads the current
guest queue, uses requested play durations, adjacent-lane rules, reservations,
and the existing five-minute bowling cleaning buffer. A retained zero occupied
timer therefore does not turn into No Wait. The public response exposes an
`availabilityStatus` of `estimated` and an `availabilityExpiresAt`. Both guest
and TV components enforce that expiry locally even when polling fails.

Staff graphics/countdowns use the same display grace. Reconnecting/estimated
labels are shown instead of a momentary all-unknown scene; the full attention
warning remains after three minutes without a fresh source snapshot. Real
assignment/control paths do not opt into display continuity and reject any
estimated lane, unhealthy feed, or stale evidence. Raw PicoKVM control readback
is separate from the continuity tracker. No new bowling control UI is included.

## Source locations and release isolation

The Cloudflare release checkout is `OnParWaitlist-bowling-continuity/web`,
created from deployed base `baafce38e2ddbbc4fd965385a2f16e6c332a6ca4`.
Do not deploy the separate `OnParWaitlist-luckfox-controls` worktree while its
unreleased controls remain unvalidated.

The active Mac LaunchAgent remains `com.onpar.brunswick-watcher`, loading
`OnParWaitlist/web/scripts/watch-brunswick-picokvm.mjs`. Its local fix includes
`brunswick-picokvm-continuity.mjs` and
`test-brunswick-picokvm-continuity.mjs`. These depend on the existing local
PicoKVM watcher stack, not the old browser watcher tracked at the deployed base.
Keep private `.brunswick-helper` state, tokens, cookies, and screenshots out of
source control. Chrome is not required for this browser-free watcher.

## Validation

- `node scripts/test-bowling-display-continuity.mjs`: behavioral source/evidence
  expiry, actual availability/board functions, exact 180-second boundary race,
  strict assignment, queue/cleaning math, and guest/TV component rendering.
- `node scripts/test-waitlist-reliability.mjs`
- `node scripts/test-bowling-cleaning-buffer.mjs`
- `node scripts/test-wait-estimate.mjs`
- TypeScript, changed-file ESLint, and Cloudflare production build.
- Active watcher: `node --test scripts/test-brunswick-picokvm-*.mjs` — 160
  passing tests, including native Apple Vision fixtures with normal macOS access.
  These are offline tests and do not start games or send SMS.

Deploy API metadata support before restarting the local watcher. Verify the
production snapshot echoes `observedAt`/`estimated`, source captures advance,
and public board expiry remains anchored to source evidence. Use read-only
checks; simulate interruptions in tests, not by interrupting active guests.

Pre-change Worker rollback version:
`a5e81d6f-1974-454f-b7d6-89af8cd50905`.
