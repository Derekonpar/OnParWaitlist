# Brunswick watcher recovery runbook

## What failed during the August 4, 2026 test

The first watcher runs were one-shot tests, so no process remained active when
Brunswick returned to its login screen. Full-display screenshots were also
contaminated by overlapping Codex and staff windows, causing valid lanes to be
missed and unrelated text to be interpreted as timers.

After switching to isolated Chrome-window capture, the original System Events
automation was blocked by macOS Accessibility error `-25211`. Unicode text
injection also did not travel correctly through Google Remote Desktop: the
remote login received `aa` instead of `bowling`. Finally, Windows treated a
double-click on the `Desk` filename as a rename because OCR located the label,
not the shortcut artwork.

## Durable fix

- Capture the Brunswick Chrome window by its Core Graphics window ID. Other
  applications can no longer hide lane cards or contribute OCR text.
- Resolve ambiguous OCR lane numbers using their fixed card positions.
- Run continuously at a 10-second local cadence, write only on changes, and
  send a 60-second heartbeat.
- Require three consecutive open readings before an occupied lane is released;
  this prevents a single OCR miss during a Brunswick redraw from creating false
  availability.
- Persist watcher health in Supabase and show a global staff warning for an
  explicit error or any snapshot older than two minutes.
- Detect DESK LOGIN, Remote Desktop access-code, offline, Windows desktop, and
  live-feed states. Recovery retries are limited to once every 30 seconds.
- Use the locally signed `Brunswick Input.app` helper for GUI events. It emits
  physical keycodes that Google Remote Desktop accepts and receives secrets on
  standard input, not command-line arguments.
- Double-click above the OCR `Desk` label so the Windows shortcut launches
  instead of entering rename mode.
- Install a per-user LaunchAgent that opens a supervised watcher loop in
  Terminal at login. Running the capture from Terminal is deliberate: macOS
  does not transfer Terminal's Screen Recording grant to a headless process.
  The loop restarts the watcher automatically if it exits.
- Run the watcher under `caffeinate -di`. The Mac was already configured not to
  idle-sleep on AC power, but macOS makes Chrome windows temporarily
  uncapturable when the display sleeps. Screen-based Brunswick OCR therefore
  requires an awake display session. Dim the monitor or turn it off using its
  own hardware control instead of macOS display sleep.

## New-computer setup

From `web/`:

```bash
./scripts/build-brunswick-input.sh
./.brunswick-helper/Brunswick\ Input.app/Contents/MacOS/Brunswick\ Input prompt
./scripts/install-brunswick-watcher.sh
```

Grant Terminal Screen Recording and Automation access. Grant `Brunswick Input`
Accessibility access. Keep Google Chrome installed and leave the Brunswick
Remote Desktop tab available.

If Node is not on Terminal's PATH, install with:

```bash
BRUNSWICK_NODE_BIN=/absolute/path/to/node ./scripts/install-brunswick-watcher.sh
```

## Verification

```bash
pgrep -fl watch-brunswick-lanes.mjs
tail -f ~/Library/Logs/OnParBrunswickWatcher.log
```

A healthy log alternates between `posted` when lane data changes and
`unchanged` between changes. Force a safe recovery test by leaving the existing
Brunswick login screen visible; do not intentionally shut down the venue's main
server during operating hours.

The staff dashboard must show a red Brunswick warning within two minutes if the
watcher stops, loses the feed, cannot log in, or cannot reach the main computer.
