# Bowling public estimates — September 11, 2026

The normal PicoKVM HDMI/OCR watcher remains the production source. Native
Brunswick protocol investigation is paused; no diagnostic/native feed is in use.

## Guest and TV behavior

- A positively observed open lane contributes zero wait. When all usable lanes
  are occupied, the earliest release plus the existing five-minute cleaning
  buffer is the starting estimate.
- Retained lane evidence stores absolute availability times in the existing
  `bowling_lane_state.lanes` JSON (`displayReading`). A failed or unknown frame
  cannot erase this display-only evidence or renew its observation timestamp.
- Queue planning uses those absolute times and guests' arrival times. Every
  requested duration and cleaning buffer is included. Multi-lane parties still
  require an adjacent group, not just the single earliest lane.
- `/api/waitlist/board` and personal status expose `waitReadyAt`, `waitSourceAt`,
  and `waitEstimateExpiresAt`. The home, TV and personal status views count down
  locally between polls, including when a request fails. No extra polling is
  needed; existing 15-second board/status polling remains.
- Fresh snapshots and queue changes recalculate the estimate. A zero estimate
  never serves/removes a guest or starts/clears an actual lane.
- Known Event Host reservations keep their existing 65-minute protection and
  exact scheduled end, plus bowling cleaning turnover for capacity. Their
  windows are reapplied from saved timestamps even during a feed/schedule outage.
  An ended event no longer adds an endless five-minute hold.
- This is explicitly an **Estimated wait**, not a claim that the live device
  connection is healthy. Retention is limited to 12 hours from original evidence;
  missing/invalid/expired evidence says **Check with staff**, never invented
  availability. Healthy empty lanes do not flash **Updating** after three minutes.

## Unchanged operational protections

The staff lane graphics, source-health warnings and real placement/start checks
continue to use strict live evidence. `displayReading` must never be used as a
hardware-control authorization. Darts/pool/shuffleboard live-source policies are
unchanged. No guest records or schema migrations are needed for this change.

The temporary `PUBLIC_BOWLING_NO_WAIT_OVERRIDE` must be disabled after release
verification so real queue and event estimates are visible again. It remains a
separate emergency presentation switch; it is not the new estimate mechanism.

## Verification

Run `node scripts/test-bowling-wait-projection.mjs`, the existing bowling display,
cleaning, reservation-protection, board and waitlist reliability checks, typecheck,
and the Cloudflare build. Tests use only synthetic in-memory data. Verify live
watcher publication via authenticated GET `/api/staff/bowling-lanes`; verify
public countdown metadata via GET `/api/waitlist/board`. Do not create guests,
send SMS, or start lanes to test estimate rendering.

## Watcher restoration

Quit any exclusive Pico inspection session before restoring the LaunchAgent
`com.onpar.brunswick-watcher`. The normal watcher can recover Desk login itself;
it then requires clock advancement and consecutive lane frames before publishing.
Successful restoration means fresh production `capturedAt`, `healthStatus: ok`
and 12 lane readings—not merely a running process. No Chrome viewer is needed.
