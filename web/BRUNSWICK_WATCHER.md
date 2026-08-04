# Brunswick Lane Watcher

The staff Bowling lanes tab reads one latest snapshot from Supabase. This local
watcher keeps that snapshot fresh by OCR-reading the open Brunswick Google
Remote Desktop tab on the Mac.

## One-time database setup

Run both migrations in Supabase SQL Editor:

```text
../supabase/add_bowling_lane_state.sql
../supabase/add_bowling_feed_health.sql
```

## Run the watcher

Build the dedicated macOS input helper once on each watcher computer:

```bash
cd web
./scripts/build-brunswick-input.sh
./.brunswick-helper/Brunswick\ Input.app/Contents/MacOS/Brunswick\ Input prompt
```

Enable `Brunswick Input` when macOS requests Accessibility access. This stable,
locally signed helper sends the physical mouse and keyboard events required by
Google Remote Desktop; passwords are passed over standard input rather than in
process arguments. Terminal still needs Screen Recording and Automation access.

Keep the Brunswick Remote Desktop tab open in Google Chrome, then run:

```bash
cd web
npm run watch:brunswick -- --interval 10
```

For a one-shot test without posting:

```bash
cd web
npm run watch:brunswick -- --once --dry-run
```

macOS may ask for Screen Recording and Automation permissions for the terminal
app running the watcher. The watcher does not use a Chrome extension; it only
selects the existing Brunswick tab, captures that Chrome window directly, runs
native Apple Vision OCR, and posts the parsed lane timers to
`/api/staff/bowling-lanes`. Capturing the window directly prevents other open
staff or Codex windows from hiding lane cards or contributing unrelated text.

The watcher captures locally every 10 seconds by default, but writes only when
lane data changes or once per minute as a health heartbeat. Override the
heartbeat with `BRUNSWICK_HEARTBEAT_MS` if needed.

## Automatic recovery

The watcher recognizes the Brunswick login screen and signs back in using
`BRUNSWICK_USERNAME` and `BRUNSWICK_PASSWORD` (both default to `bowling`). It
also recognizes the Google Remote Desktop access-code screen, enters
`BRUNSWICK_REMOTE_CODE` (default `446464`), and opens the desktop `Desk` app.
Recovery attempts are limited to once every 30 seconds.

For the incident history, recovery decisions, new-computer checklist, and
verification commands, see `docs/BRUNSWICK_RECOVERY_RUNBOOK.md`.

If the main Brunswick computer is off or cannot be reached, the watcher records
a feed-health error. A red banner then appears throughout the staff dashboard
with instructions to turn the computer on and restore Remote Desktop. The last
good lane snapshot remains available while the feed is recovering.
