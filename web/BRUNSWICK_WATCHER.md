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

The watcher owns a dedicated one-tab Chrome window for Brunswick Remote
Desktop. If it finds an older Remote Access tab mixed into a normal browsing
window, it moves recovery to the dedicated window and removes the duplicate.
Normal OCR captures do not activate Chrome, raise its window, or change the
tab where staff are working. Then run:

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

The installed watcher uses `caffeinate -di`. macOS window capture stops working
when the display session sleeps, even if the Mac itself remains awake. For an
unattended watcher, keep macOS display sleep disabled and dim or power off the
physical monitor instead.

The watcher captures locally every 10 seconds by default, but writes only when
lane data changes or once per minute as a health heartbeat. Override the
heartbeat with `BRUNSWICK_HEARTBEAT_MS` if needed.

## Automatic recovery

If Remote Desktop is closed, the watcher reopens its dedicated window, selects
`BrunswickHQ`, enters `BRUNSWICK_REMOTE_CODE` (default `446464`), opens the
remote computer, and handles a newly booted or locked Windows instance. On the
Windows lock screen it sends Ctrl+Alt+Delete, selects Owner, and enters
`BRUNSWICK_WINDOWS_OWNER_PASSWORD` (default `owner`). It allows up to 90
seconds for Windows to finish starting, opens the desktop `Desk` app, allows up
to another minute for Desk to load, and then recognizes the Brunswick login
screen and signs back in using
`BRUNSWICK_USERNAME` and `BRUNSWICK_PASSWORD` (both default to `bowling`). It
briefly focuses the dedicated window only for a required click or keystroke and
then restores the app, Chrome window, and tab the user was using. Failed host
clicks retry on the next scan; a transition to a new recovery screen proceeds
immediately instead of inheriting the previous step's cooldown.

For the incident history, recovery decisions, new-computer checklist, and
verification commands, see `docs/BRUNSWICK_RECOVERY_RUNBOOK.md`.

If the main Brunswick computer is off or cannot be reached, the watcher records
a feed-health error. A red banner then appears throughout the staff dashboard
with instructions to turn the computer on and restore Remote Desktop. The last
good lane snapshot remains available while the feed is recovering.
