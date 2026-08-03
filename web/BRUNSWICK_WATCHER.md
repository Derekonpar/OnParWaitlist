# Brunswick Lane Watcher

The staff Bowling lanes tab reads one latest snapshot from Supabase. This local
watcher keeps that snapshot fresh by OCR-reading the open Brunswick Google
Remote Desktop tab on the Mac.

## One-time database setup

Run `../supabase/add_bowling_lane_state.sql` in Supabase SQL Editor.

## Run the watcher

Keep the Brunswick Remote Desktop tab open in Google Chrome, then run:

```bash
cd web
npm run watch:brunswick -- --interval 5
```

For a one-shot test without posting:

```bash
cd web
npm run watch:brunswick -- --once --dry-run
```

macOS may ask for Screen Recording and Automation permissions for the terminal
app running the watcher. The watcher does not use a Chrome extension; it only
selects the existing Brunswick tab, screenshots the visible screen, runs native
Apple Vision OCR, and posts the parsed lane timers to `/api/staff/bowling-lanes`.

If this computer leaves Wi-Fi or the Remote Desktop session disconnects, the
staff tab keeps showing the last posted snapshot but will label it as old.
