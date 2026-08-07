#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const ocrScript = path.join(scriptDir, "brunswick-ocr.swift");
const windowIdScript = path.join(scriptDir, "brunswick-window-id.swift");
const inputHelper = path.join(
  appDir,
  ".brunswick-helper",
  "Brunswick Input.app",
  "Contents",
  "MacOS",
  "Brunswick Input",
);
const DEFAULT_POST_HEARTBEAT_MS = 60_000;
const DEFAULT_RECOVERY_COOLDOWN_MS = 20_000;
let lastPostedSignature = "";
let lastPostedAt = 0;
let lastHealthSignature = "";
let lastHealthPostedAt = 0;
let lastRecoveryAttemptAt = 0;
let lastRecoveryState = "";
let currentCaptureBounds = null;
let previousObservedLanes = null;
let windowsBootExpectedUntil = 0;
let deskLaunchExpectedUntil = 0;
const consecutiveOpenScans = new Map();

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i);
    let value = trimmed.slice(i + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function readArgs() {
  const args = {
    once: false,
    dryRun: false,
    interval: 10,
    baseUrl: undefined,
    secret: undefined,
    screenshot: undefined,
  };

  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--once") args.once = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--interval") args.interval = Number(process.argv[++i]);
    else if (arg === "--base-url") args.baseUrl = process.argv[++i];
    else if (arg === "--secret") args.secret = process.argv[++i];
    else if (arg === "--screenshot") args.screenshot = process.argv[++i];
    else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run watch:brunswick -- [options]

Options:
  --once                    Capture one snapshot and exit
  --dry-run                 Print parsed lanes without POSTing
  --interval 10             Seconds between local captures
  --base-url URL            Staff app URL, default NEXT_PUBLIC_APP_URL
  --secret SECRET           Staff secret, default STAFF_SECRET
  --screenshot PATH         Parse an existing screenshot instead of capturing Chrome

The watcher selects the open Brunswick Google Remote Desktop tab, takes a
screenshot, OCRs the visible lane timers, and posts only changes or a periodic
heartbeat. It can recover the known Brunswick login and Remote Desktop flow.`);
}

function observationText(observations) {
  return observations.map((obs) => String(obs.text ?? "")).join("\n");
}

function findObservation(observations, patterns) {
  return observations.find((obs) =>
    patterns.some((pattern) => pattern.test(String(obs.text ?? ""))),
  );
}

function detectScreenState(observations) {
  const text = observationText(observations);
  const laneLabels = observations.filter((obs) => /\bLane\s*\d{1,2}\b/i.test(String(obs.text ?? "")));
  if (/\bBowling\b/i.test(text) && laneLabels.length >= 2) return "feed";
  if (/ctrl\s*\+?\s*alt\s*\+?\s*delete|ctrl\s*-\s*alt\s*-\s*del/i.test(text)) {
    return "windows-lock";
  }
  if (/\bOwner\b/i.test(text) && /password|sign\s*in/i.test(text)) {
    return "windows-owner-login";
  }
  if (/\bOwner\b/i.test(text)) return "windows-owner-select";
  if (/welcome|please wait|preparing windows|just a moment|getting windows ready/i.test(text)) {
    return "windows-booting";
  }
  if (
    /password/i.test(text) &&
    ((/user\s*name|username/i.test(text) && /log\s*in|sign\s*in/i.test(text)) ||
      (/desk\s*login/i.test(text) && /^User$/im.test(text)))
  ) {
    return "brunswick-login";
  }
  if (/host is offline|computer is offline|unable to connect|can(?:not|'t) connect|not available|turned off/i.test(text)) {
    return "remote-offline";
  }
  // Chrome Remote Desktop's connected-session PIN screen often contains only
  // "Enter PIN" plus a remotedesktop.google.com URL. Do not require the
  // spaced words "Remote Desktop" or the BrunswickHQ card beneath it wins.
  if (/enter\s*(?:access\s*)?(?:code|pin)|remember my pin|\bpin\b/i.test(text)) {
    return "remote-code";
  }
  if (findObservation(observations, [/^Desk$/i])) return "remote-desktop";
  // The connected Chrome tab is also titled BrunswickHQ. Only text inside the
  // Remote Access page body is a selectable host; ignore the browser chrome.
  if (
    observations.some(
      (obs) => /Brunswick\s*HQ/i.test(String(obs.text ?? "")) && Number(obs.y) < 0.9,
    )
  ) return "remote-host-list";
  if (Date.now() < windowsBootExpectedUntil) return "windows-booting";
  if (Date.now() < deskLaunchExpectedUntil) return "desk-starting";
  return "unknown";
}

function parseTimer(text) {
  const match = text.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes > 59) return null;
  if (hours > 12) return null;
  return (hours * 60 + minutes) * 60;
}

function laneTimerFromText(text) {
  const cleaned = text.replace(/[Oo](?=\s*:)/g, "0");
  const normal = cleaned.match(
    /\bLane\s*(1[0-2]|[1-9])\D+(\d{1,2})\s*:\s*(\d{2})\b/i,
  );
  const joined = cleaned.match(
    /\bLane\s*(1[0-2]|[1-9])(\d{1,2})\s*:\s*(\d{2})\b/i,
  );
  const match = normal ?? joined;
  if (!match) return null;
  const lane = Number(match[1]);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 12 || minutes > 59) return null;
  return { lane, remainingSeconds: (hours * 60 + minutes) * 60 };
}

function laneFromCardPosition(obs) {
  const firstColumnX = 0.19;
  const columnWidth = 0.064;
  const column = Math.round((obs.x - firstColumnX) / columnWidth);
  if (column < 0 || column > 7) return null;
  if (Math.abs(obs.x - (firstColumnX + column * columnWidth)) > 0.035) return null;
  if (obs.y >= 0.76 && obs.y <= 0.84) return column + 1;
  if (obs.y >= 0.67 && obs.y < 0.76 && column <= 3) return column + 9;
  return null;
}

function reservationLaneFromCardPosition(obs, observations) {
  const isTopRow = obs.y >= 0.72 && obs.y < 0.765;
  const isBottomRow = obs.y >= 0.625 && obs.y < 0.69;
  if (!isTopRow && !isBottomRow) return null;

  // Match reservation text to the nearest visible Lane N header. This is more
  // reliable than fixed columns because Remote Desktop scaling and the split
  // Brunswick layout move the cards slightly between sessions.
  const nearestHeader = observations
    .map((candidate) => {
      const match = String(candidate.text ?? "").trim().match(/^Lane\s*(1[0-2]|[1-9])$/i);
      if (!match) return null;
      const lane = Number(match[1]);
      if (isTopRow && lane > 8) return null;
      if (isBottomRow && lane < 9) return null;
      return { lane, distance: Math.abs(Number(candidate.x) - Number(obs.x)) };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearestHeader && nearestHeader.distance <= 0.045) return nearestHeader.lane;

  // Fallback for a scan where OCR misses the lane header as well as nearby
  // labels. These values reflect the current normalized card geometry.
  const firstColumnX = 0.151;
  const columnWidth = 0.068;
  const column = Math.round((obs.x - firstColumnX) / columnWidth);
  if (column < 0 || column > 7) return null;
  if (Math.abs(obs.x - (firstColumnX + column * columnWidth)) > 0.04) return null;
  if (isTopRow) return column + 1;
  if (isBottomRow && column <= 3) return column + 9;
  return null;
}

function extractLanes(observations) {
  const lanes = Array.from({ length: 12 }, (_, i) => ({
    lane: i + 1,
    status: "open",
    remainingSeconds: 0,
    rawText: undefined,
    confidence: undefined,
  }));

  const timed = observations
    .map((obs) => {
      const text = String(obs.text ?? "");
      const joinedLaneTimer = laneTimerFromText(text);
      return {
        ...obs,
        remainingSeconds:
          joinedLaneTimer?.remainingSeconds ?? parseTimer(text),
      };
    })
    .filter((obs) => obs.remainingSeconds !== null);

  for (const obs of observations) {
    const text = String(obs.text ?? "").trim();
    const lane = reservationLaneFromCardPosition(obs, observations);
    // Score fragments and game numbers (for example "23 #1" or "20") can
    // occupy the same OCR band as Brunswick reservation names. A real hold
    // label contains a name/word, so ignore number-only fragments here.
    if (
      !lane ||
      !text ||
      !/[a-z]/i.test(text) ||
      /^Lane\s*\d+$/i.test(text) ||
      parseTimer(text) !== null
    ) {
      continue;
    }
    lanes[lane - 1] = {
      lane,
      status: "reserved",
      remainingSeconds: 0,
      reservationLabel: text.slice(0, 100),
      rawText: text.slice(0, 100),
      confidence: Number(obs.confidence ?? 0),
    };
  }

  for (const obs of timed) {
    const text = String(obs.text ?? "");
    const parsed = laneTimerFromText(text);
    if (!parsed) continue;
    // The Brunswick lane headers live in this fixed band after the Chrome
    // window is positioned by selectBrunswickTab. This prevents phrases such
    // as "lane 7 at 1:00" in another overlapping window from becoming data.
    if (obs.y < 0.69 || obs.y > 0.84 || obs.x > 0.65) continue;

    const positionedLane = laneFromCardPosition(obs);
    const lane = positionedLane ?? parsed.lane;
    lanes[lane - 1] = {
      lane,
      status: "occupied",
      remainingSeconds: parsed.remainingSeconds,
      rawText: text.slice(0, 100),
      confidence: Number(obs.confidence ?? 0),
    };
  }

  return lanes;
}

function summarizeLanes(lanes) {
  const occupied = lanes
    .filter((lane) => lane.status === "occupied")
    .map((lane) => `L${lane.lane} ${formatClock(lane.remainingSeconds)}`);
  const openCount = lanes.filter((lane) => lane.status === "open").length;
  const reserved = lanes
    .filter((lane) => lane.status === "reserved")
    .map((lane) => `L${lane.lane} reserved${lane.reservationLabel ? ` (${lane.reservationLabel})` : ""}`);
  return `${occupied.length ? occupied.join(", ") : "no timers"}; ${reserved.length ? `${reserved.join(", ")}; ` : ""}${openCount} open`;
}

function stabilizeLaneOpenings(lanes) {
  if (!previousObservedLanes) {
    previousObservedLanes = lanes;
    return lanes;
  }

  const stabilized = lanes.map((lane) => {
    const previous = previousObservedLanes?.[lane.lane - 1];
    if (lane.status === "occupied") {
      consecutiveOpenScans.delete(lane.lane);
      return lane;
    }
    if (previous?.status !== "occupied" || previous.remainingSeconds <= 0) {
      consecutiveOpenScans.delete(lane.lane);
      return lane;
    }

    const openScans = (consecutiveOpenScans.get(lane.lane) ?? 0) + 1;
    consecutiveOpenScans.set(lane.lane, openScans);
    // Require three consecutive scans before an occupied lane becomes open.
    // Brunswick OCR occasionally misses one header while the feed redraws.
    return openScans < 3 ? previous : lane;
  });
  previousObservedLanes = stabilized;
  return stabilized;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

async function selectBrunswickTab() {
  const script = `
tell application "Google Chrome"
  -- Prefer a window whose active tab is already Brunswick. Chrome may restore
  -- an extra New Tab after a reboot, so tab count is not a reliable identity.
  -- Merely capturing it must not activate Chrome or change the active tab.
  set dedicatedWindowId to ""
  repeat with w in windows
    set t to active tab of w
    if (title of t contains "Brunswick") or (URL of t contains "remotedesktop.google.com/access") then
      set dedicatedWindowId to (id of w) as text
      exit repeat
    end if
  end repeat

  if dedicatedWindowId is not "" then
    -- Old watcher versions could leave another Remote Access tab mixed into
    -- the user's normal Chrome window. Remove only those exact duplicates.
    repeat with w in windows
      if (id of w as text) is not dedicatedWindowId then
        repeat with tabIndex from (count tabs of w) to 1 by -1
          set t to tab tabIndex of w
          if (title of t contains "Brunswick") or (URL of t contains "remotedesktop.google.com/access") then
            close t
          end if
        end repeat
      else
        try
          set minimized of w to false
          set bounds of w to {0, 25, 1400, 950}
        end try
      end if
    end repeat
    return "SELECTED_DEDICATED_BRUNSWICK"
  end if

  -- If an older watcher tab lives alongside the user's tabs, move recovery to
  -- a dedicated window once. Future scans then leave the user's window alone.
  set targetURL to ""
  set oldTab to missing value
  repeat with w in windows
    repeat with t in tabs of w
      if (title of t contains "Brunswick") or (URL of t contains "remotedesktop.google.com/access") then
        set targetURL to URL of t
        set oldTab to t
        exit repeat
      end if
    end repeat
    if targetURL is not "" then exit repeat
  end repeat

  set newWindow to make new window
  set bounds of newWindow to {0, 25, 1400, 950}
  set minimized of newWindow to false
  if targetURL is "" then
    set URL of active tab of newWindow to "https://remotedesktop.google.com/access"
  else
    set URL of active tab of newWindow to targetURL
    try
      close oldTab
    end try
  end if
  return "OPENED_DEDICATED_BRUNSWICK"
end tell
return "NOT_FOUND"
`;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const result = stdout.trim();
  if (
    result !== "SELECTED_DEDICATED_BRUNSWICK" &&
    result !== "OPENED_DEDICATED_BRUNSWICK"
  ) {
    throw new Error("Could not find the open Brunswick Remote Desktop tab.");
  }
  return result;
}

async function frontmostContext() {
  const script = `
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
end tell
set chromeWindowId to ""
set chromeTabIndex to ""
if frontApp is "Google Chrome" then
  tell application "Google Chrome"
    try
      set chromeWindowId to (id of front window) as text
      set chromeTabIndex to (active tab index of front window) as text
    end try
  end tell
end if
return frontApp & "|||" & chromeWindowId & "|||" & chromeTabIndex
`;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const [appName, chromeWindowId, chromeTabIndex] = stdout.trim().split("|||");
  return { appName, chromeWindowId, chromeTabIndex };
}

async function focusBrunswickWindow() {
  const script = `
tell application "Google Chrome"
  repeat with w in windows
    set t to active tab of w
    if (title of t contains "Brunswick") or (URL of t contains "remotedesktop.google.com/access") then
      set index of w to 1
      activate
      return
    end if
  end repeat
end tell
`;
  await execFileAsync("osascript", ["-e", script]);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function restoreFrontmostContext(context) {
  if (!context?.appName) return;
  const script = `on run argv
set appName to item 1 of argv
set chromeWindowId to item 2 of argv
set chromeTabIndex to item 3 of argv
if appName is "Google Chrome" and chromeWindowId is not "" then
  tell application "Google Chrome"
    repeat with w in windows
      if (id of w as text) is chromeWindowId then
        set active tab index of w to chromeTabIndex as integer
        set index of w to 1
        activate
        return
      end if
    end repeat
  end tell
else
  tell application "System Events"
    if exists application process appName then set frontmost of application process appName to true
  end tell
end if
end run`;
  try {
    await execFileAsync("osascript", [
      "-e",
      script,
      context.appName,
      context.chromeWindowId ?? "",
      context.chromeTabIndex ?? "",
    ]);
  } catch (error) {
    // A Chrome window can disappear while recovery is running. Restoring the
    // user's prior focus is best-effort and must never abort lane recovery.
    console.error(`${new Date().toLocaleTimeString()} focus restore skipped: ${error.message}`);
  }
}

async function desktopSize() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'tell application "Finder" to get bounds of window of desktop',
  ]);
  const values = stdout.match(/-?\d+/g)?.map(Number) ?? [];
  if (values.length < 4) throw new Error("Could not read desktop bounds");
  return {
    x: values[0],
    y: values[1],
    width: values[2] - values[0],
    height: values[3] - values[1],
  };
}

async function clickObservation(observation) {
  const screen = currentCaptureBounds ?? (await desktopSize());
  const x = Math.round(screen.x + Number(observation.x) * screen.width);
  const y = Math.round(screen.y + (1 - Number(observation.y)) * screen.height);
  if (existsSync(inputHelper)) {
    await execFileAsync(inputHelper, ["click", String(x), String(y)]);
    return;
  }
  await execFileAsync("osascript", ["-e", `tell application "System Events" to click at {${x}, ${y}}`]);
}

async function replaceFocusedText(value, submit = false) {
  if (existsSync(inputHelper)) {
    await new Promise((resolve, reject) => {
      const child = spawn(inputHelper, ["replace", ...(submit ? ["--submit"] : [])], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Brunswick Input exited ${code}`));
      });
      child.stdin.end(value);
    });
    return;
  }
  const script = `on run argv
tell application "System Events"
  keystroke "a" using command down
  keystroke item 1 of argv
  ${submit ? "key code 36" : ""}
end tell
end run`;
  await execFileAsync("osascript", ["-e", script, value]);
}

async function sendCtrlAltDelete() {
  if (existsSync(inputHelper)) {
    await execFileAsync(inputHelper, ["ctrl-alt-delete"]);
    return;
  }
  const script = `tell application "System Events"
key code 117 using {control down, option down}
end tell`;
  await execFileAsync("osascript", ["-e", script]);
}

function recoveryCooldownMs(state) {
  // Host selection is safe to retry on the next scan when a click does not
  // take. Login typing is intentionally slower to avoid duplicate submits.
  if (state === "remote-host-list") return 8_000;
  if (state === "remote-code" || state === "remote-desktop") return 12_000;
  if (state === "windows-lock" || state === "windows-owner-select") return 12_000;
  if (state === "windows-owner-login") return 30_000;
  return DEFAULT_RECOVERY_COOLDOWN_MS;
}

function recoveryAttemptDue(state) {
  return (
    state !== lastRecoveryState ||
    Date.now() - lastRecoveryAttemptAt >= recoveryCooldownMs(state)
  );
}

function waitingRecoveryHealth(state) {
  return {
    healthStatus: state === "brunswick-login" ? "login-required" : "recovering",
    healthMessage: "Brunswick recovery is waiting before another safe retry. Lane times may be stale.",
  };
}

async function recoverScreen(state, observations, options) {
  lastRecoveryAttemptAt = Date.now();
  lastRecoveryState = state;

  if (state === "windows-lock") {
    await sendCtrlAltDelete();
    return {
      healthStatus: "recovering",
      healthMessage: "Windows was locked. Ctrl+Alt+Delete was sent; waiting for the Owner sign-in screen.",
    };
  }

  if (state === "windows-owner-select") {
    const owner = findObservation(observations, [/^Owner$/i]);
    if (owner) await clickObservation(owner);
    return {
      healthStatus: "recovering",
      healthMessage: "The Windows Owner profile was selected. Waiting for its password field.",
    };
  }

  if (state === "windows-owner-login") {
    const password = findObservation(observations, [/password/i]);
    if (password) {
      await clickObservation(password);
      await replaceFocusedText(options.windowsOwnerPassword, true);
      windowsBootExpectedUntil = Date.now() + 90_000;
    }
    return {
      healthStatus: "recovering",
      healthMessage: "The Windows Owner password was submitted. Startup can take up to one minute.",
    };
  }

  if (state === "windows-booting") {
    return {
      healthStatus: "recovering",
      healthMessage: "The Brunswick computer is starting Windows. Waiting up to one minute for the desktop.",
    };
  }

  if (state === "desk-starting") {
    return {
      healthStatus: "recovering",
      healthMessage: "Desk is starting. Waiting up to one minute for the Brunswick login or lane feed.",
    };
  }

  if (state === "brunswick-login") {
    const username = findObservation(observations, [/user\s*name|username/i, /^User$/i]);
    const password = findObservation(observations, [/password/i]);
    if (!username || !password) {
      return {
        healthStatus: "login-required",
        healthMessage: "Brunswick login is visible but the fields could not be identified. Open the remote view and sign in.",
      };
    }
    // OCR sees the labels; the editable boxes are immediately to their right.
    await clickObservation({ ...username, x: Number(username.x) + 0.15 });
    await replaceFocusedText(options.brunswickUsername);
    await clickObservation({ ...password, x: Number(password.x) + 0.14 });
    await replaceFocusedText(options.brunswickPassword, true);
    return {
      healthStatus: "recovering",
      healthMessage: "Brunswick login was detected and submitted automatically. Waiting for the lane feed.",
    };
  }

  if (state === "remote-code") {
    const codeField = findObservation(observations, [/access code|enter.*code|\bpin\b/i]);
    if (!codeField) {
      return {
        healthStatus: "error",
        healthMessage: "Restart Remote Desktop, enter code 446464, then open Desk.",
      };
    }
    await clickObservation(codeField);
    await replaceFocusedText(options.remoteCode, true);
    return {
      healthStatus: "recovering",
      healthMessage: "Remote Desktop code was submitted. Waiting for the Brunswick desktop.",
    };
  }

  if (state === "remote-host-list") {
    const host = observations.find(
      (obs) => /Brunswick\s*HQ/i.test(String(obs.text ?? "")) && Number(obs.y) < 0.9,
    );
    if (host) await clickObservation(host);
    return {
      healthStatus: "recovering",
      healthMessage: "BrunswickHQ was selected. Waiting for the Remote Desktop access code prompt.",
    };
  }

  if (state === "remote-desktop") {
    windowsBootExpectedUntil = 0;
    const desk = findObservation(observations, [/^Desk$/i]);
    if (desk) {
      // OCR targets the filename below the Windows shortcut. Move upward to
      // the shortcut artwork so a double-click launches it instead of renaming it.
      const deskIcon = { ...desk, y: Number(desk.y) + 0.055 };
      await clickObservation(deskIcon);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await clickObservation(deskIcon);
      deskLaunchExpectedUntil = Date.now() + 60_000;
    }
    return {
      healthStatus: "recovering",
      healthMessage: "The Brunswick desktop was reached and Desk was opened. Waiting for lane data.",
    };
  }

  if (state === "remote-offline") {
    return {
      healthStatus: "remote-offline",
      healthMessage: "The main Brunswick computer appears off or unreachable. Turn it back on. If needed, restart Remote Desktop, enter code 446464, then open Desk.",
    };
  }

  return {
    healthStatus: "error",
    healthMessage: "Brunswick lane data is not visible. Restart the Remote Desktop window, enter code 446464 if prompted, then open Desk.",
  };
}

async function captureScreenshot() {
  const priorContext = await frontmostContext();
  const selection = await selectBrunswickTab();
  if (selection === "OPENED_DEDICATED_BRUNSWICK") {
    // Creating the isolated window may briefly raise Chrome. Put the user
    // straight back where they were; normal captures never take focus.
    await restoreFrontmostContext(priorContext);
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  const dir = await mkdtemp(path.join(tmpdir(), "brunswick-lanes-"));
  const screenshotPath = path.join(dir, "screen.png");
  const { stdout } = await execFileAsync("swift", [windowIdScript]);
  const captureWindow = JSON.parse(stdout);
  if (!Number.isInteger(captureWindow.id)) {
    throw new Error("Could not resolve the Brunswick Chrome capture window");
  }
  currentCaptureBounds = captureWindow;
  // Capture the Chrome window itself so staff/Codex windows cannot obscure
  // lane cards or contribute unrelated timer text to OCR.
  await execFileAsync("screencapture", ["-x", "-o", "-l", String(captureWindow.id), screenshotPath]);
  return screenshotPath;
}

async function runOcr(screenshotPath) {
  const { stdout } = await execFileAsync("swift", [ocrScript, screenshotPath], {
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout);
}

async function postSnapshot({ baseUrl, secret, lanes, capturedAt }) {
  const url = new URL("/api/staff/bowling-lanes", baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-staff-secret": secret,
    },
    body: JSON.stringify({
      source: "brunswick-ocr",
      capturedAt,
      lanes,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST failed ${response.status}: ${text}`);
  }
}

async function postHealth({ baseUrl, secret, healthStatus, healthMessage }) {
  const url = new URL("/api/staff/bowling-lanes", baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-staff-secret": secret,
    },
    body: JSON.stringify({ healthStatus, healthMessage }),
  });
  if (!response.ok) {
    throw new Error(`Health POST failed ${response.status}: ${await response.text()}`);
  }
}

function watcherFailureMessage(error) {
  if (/assistive access|-25211/i.test(String(error?.message ?? error))) {
    return "Brunswick login was detected, but macOS blocked automatic recovery. Enable Accessibility permission for the app running the watcher, then leave the Brunswick Chrome tab open.";
  }
  return "Brunswick watcher lost the feed. Check that Chrome and Remote Desktop are open. If the main computer is off, turn it on; then enter code 446464 and open Desk if needed.";
}

function laneSignature(lanes) {
  return lanes
    .map((lane) => `${lane.lane}:${lane.status}:${lane.remainingSeconds}`)
    .join("|");
}

async function captureAndPost(options) {
  const screenshotPath = options.screenshot ?? (await captureScreenshot());
  const capturedAt = options.screenshot
    ? (await stat(screenshotPath)).mtime.toISOString()
    : new Date().toISOString();
  const observations = await runOcr(screenshotPath);
  const screenState = detectScreenState(observations);
  if (screenState === "feed") {
    windowsBootExpectedUntil = 0;
    deskLaunchExpectedUntil = 0;
  }
  if (screenState !== "feed") {
    let health;
    if (screenState === "windows-booting" || screenState === "desk-starting") {
      health = await recoverScreen(screenState, observations, options);
    } else if (recoveryAttemptDue(screenState)) {
      const priorContext = await frontmostContext();
      await focusBrunswickWindow();
      try {
        health = await recoverScreen(screenState, observations, options);
      } finally {
        await restoreFrontmostContext(priorContext);
      }
    } else {
      // Do not bring Chrome forward just to discover that a retry is still on
      // cooldown. Normal recovery observation remains fully backgrounded.
      health = waitingRecoveryHealth(screenState);
    }
    const signature = `${health.healthStatus}:${health.healthMessage}`;
    const shouldPostHealth =
      signature !== lastHealthSignature ||
      Date.now() - lastHealthPostedAt >= options.heartbeatMs;
    if (!options.dryRun && shouldPostHealth) {
      await postHealth({
        baseUrl: options.baseUrl,
        secret: options.secret,
        ...health,
      });
      lastHealthSignature = signature;
      lastHealthPostedAt = Date.now();
    }
    console.log(
      `${new Date().toLocaleTimeString()} ${screenState}: ${health.healthMessage}`,
    );
    return null;
  }

  const lanes = stabilizeLaneOpenings(extractLanes(observations));
  const signature = laneSignature(lanes);
  const shouldPost =
    signature !== lastPostedSignature ||
    Date.now() - lastPostedAt >= options.heartbeatMs ||
    lastHealthSignature !== "ok";

  if (!options.dryRun && shouldPost) {
    await postSnapshot({
      baseUrl: options.baseUrl,
      secret: options.secret,
      lanes,
      capturedAt,
    });
    lastPostedSignature = signature;
    lastPostedAt = Date.now();
    lastHealthSignature = "ok";
    lastHealthPostedAt = lastPostedAt;
  }

  const prefix = options.dryRun ? "dry-run" : shouldPost ? "posted" : "unchanged";
  console.log(`${new Date().toLocaleTimeString()} ${prefix}: ${summarizeLanes(lanes)}`);
  return lanes;
}

loadEnvFile(path.join(appDir, ".dev.vars"));
loadEnvFile(path.join(appDir, ".env.production.local"));
loadEnvFile(path.join(appDir, ".env.local"));

const args = readArgs();
const options = {
  ...args,
  interval: Number.isFinite(args.interval) && args.interval > 0 ? args.interval : 10,
  baseUrl:
    args.baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://onparwaitlist.com",
  secret: args.secret ?? process.env.STAFF_SECRET,
  heartbeatMs: Number(process.env.BRUNSWICK_HEARTBEAT_MS) || DEFAULT_POST_HEARTBEAT_MS,
  brunswickUsername: process.env.BRUNSWICK_USERNAME ?? "bowling",
  brunswickPassword: process.env.BRUNSWICK_PASSWORD ?? "bowling",
  windowsOwnerPassword: process.env.BRUNSWICK_WINDOWS_OWNER_PASSWORD ?? "owner",
  remoteCode: process.env.BRUNSWICK_REMOTE_CODE ?? "446464",
};

if (!options.secret && !options.dryRun) {
  throw new Error("Missing STAFF_SECRET. Set it in .dev.vars or pass --secret.");
}

try {
  await captureAndPost(options);
} catch (error) {
  console.error(`${new Date().toLocaleTimeString()} watcher error: ${error.message}`);
  if (!options.dryRun) {
    try {
      await postHealth({
        baseUrl: options.baseUrl,
        secret: options.secret,
        healthStatus: "error",
        healthMessage: watcherFailureMessage(error),
      });
    } catch (healthError) {
      console.error(`${new Date().toLocaleTimeString()} health error: ${healthError.message}`);
    }
  }
  if (options.once) process.exitCode = 1;
}

while (!options.once) {
  await new Promise((resolve) => setTimeout(resolve, options.interval * 1000));
  try {
    await captureAndPost({ ...options, screenshot: undefined });
  } catch (error) {
    console.error(`${new Date().toLocaleTimeString()} watcher error: ${error.message}`);
    const healthMessage = watcherFailureMessage(error);
    const signature = `error:${healthMessage}`;
    if (
      !options.dryRun &&
      (signature !== lastHealthSignature ||
        Date.now() - lastHealthPostedAt >= options.heartbeatMs)
    ) {
      try {
        await postHealth({
          baseUrl: options.baseUrl,
          secret: options.secret,
          healthStatus: "error",
          healthMessage,
        });
        lastHealthSignature = signature;
        lastHealthPostedAt = Date.now();
      } catch (healthError) {
        console.error(`${new Date().toLocaleTimeString()} health error: ${healthError.message}`);
      }
    }
  }
}
