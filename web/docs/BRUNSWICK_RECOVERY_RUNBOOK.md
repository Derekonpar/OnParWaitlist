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
- Detect the Remote Access host list, `BrunswickHQ`, access-code, Windows
  Ctrl+Alt+Delete lock screen, Owner selection/password, Windows startup,
  Windows desktop, Desk startup, DESK LOGIN, and live-feed states. Each state
  has its own retry cooldown, and a transition advances immediately.
- Treat the lock prompt as optional OCR. Vision may turn
  `Ctrl+Alt+Delete` into unrelated letters or omit the small line entirely, so
  the watcher also requires the combined Remote Desktop URL, large Windows
  clock, weekday, and month signature before sending the secure-attention keys.
- If Windows restores Brunswick Office after reboot, send Windows+D to return
  to the desktop rather than entering Desk credentials into the similar Office
  login. If OCR omits the tiny `desk` label, identify the desktop from its
  surrounding icons and use the known Desk artwork position, never Desk - Copy.
- Distinguish the clickable `BrunswickHQ` host tile from the connected Chrome
  tab title by its OCR screen position. Without this check, a connected Windows
  lock screen can be mistaken for the Remote Access computer list forever.
- Keep Remote Desktop in a dedicated one-tab Chrome window. Background OCR
  never activates Chrome or changes the user's tab. Recovery briefly focuses
  only that window for GUI input and restores the previously focused app,
  Chrome window, and tab afterward.
- Clear stale mouse-button state before and after recovery clicks. This avoids
  an intermittent held-click/drag state when selecting `BrunswickHQ`.
- Send physical Ctrl+Alt+Forward-Delete through the signed input helper, enter
  the Windows Owner password, allow a 90-second boot grace period, then allow a
  separate 60-second Desk launch grace period before raising a hard error.
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
Remote Desktop account signed in. The watcher creates and maintains its own
dedicated Remote Access window.

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
`unchanged` between changes. A complete safe recovery test closes only the
dedicated Remote Access window. The watcher should reopen it, select
`BrunswickHQ`, complete the code/Desktop/login flow, return to `posted`, and
leave the user's foreground app/tab unchanged. Do not intentionally shut down
the venue's main server during operating hours.

The side-effect-free recovery classifier can be checked without focusing or
typing into Remote Desktop:

```bash
node scripts/test-brunswick-recovery.mjs
```

The staff dashboard must show a red Brunswick warning within two minutes if the
watcher stops, loses the feed, cannot log in, or cannot reach the main computer.
