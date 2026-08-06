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
const RECOVERY_COOLDOWN_MS = 30_000;
let lastPostedSignature = "";
let lastPostedAt = 0;
let lastHealthSignature = "";
let lastHealthPostedAt = 0;
let lastRecoveryAttemptAt = 0;
let currentCaptureBounds = null;
let previousObservedLanes = null;
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
  if (/remote desktop/i.test(text) && /access code|enter.*code|\bpin\b/i.test(text)) {
    return "remote-code";
  }
  if (findObservation(observations, [/^Desk$/i])) return "remote-desktop";
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

function reservationLaneFromCardPosition(obs) {
  const firstColumnX = 0.19;
  const columnWidth = 0.064;
  const column = Math.round((obs.x - firstColumnX) / columnWidth);
  if (column < 0 || column > 7) return null;
  if (Math.abs(obs.x - (firstColumnX + column * columnWidth)) > 0.035) return null;
  if (obs.y >= 0.72 && obs.y < 0.765) return column + 1;
  if (obs.y >= 0.625 && obs.y < 0.69 && column <= 3) return column + 9;
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
    const lane = reservationLaneFromCardPosition(obs);
    if (!lane || !text || /^Lane\s*\d+$/i.test(text) || parseTimer(text) !== null) {
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
  activate
  repeat with w in windows
    set tabIndex to 1
    repeat with t in tabs of w
      if (title of t contains "Brunswick") or (URL of t contains "remotedesktop.google.com/access/session") then
        set active tab index of w to tabIndex
        set minimized of w to false
        set bounds of w to {0, 25, 1400, 950}
        set index of w to 1
        return "SELECTED_BRUNSWICK"
      end if
      set tabIndex to tabIndex + 1
    end repeat
  end repeat
end tell
return "NOT_FOUND"
`;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  const result = stdout.trim();
  if (result !== "SELECTED_BRUNSWICK") {
    throw new Error("Could not find the open Brunswick Remote Desktop tab.");
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

async function recoverScreen(state, observations, options) {
  const now = Date.now();
  if (now - lastRecoveryAttemptAt < RECOVERY_COOLDOWN_MS) {
    return {
      healthStatus: state === "brunswick-login" ? "login-required" : "recovering",
      healthMessage: "Brunswick recovery is waiting before another safe retry. Lane times may be stale.",
    };
  }
  lastRecoveryAttemptAt = now;

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

  if (state === "remote-desktop") {
    const desk = findObservation(observations, [/^Desk$/i]);
    if (desk) {
      // OCR targets the filename below the Windows shortcut. Move upward to
      // the shortcut artwork so a double-click launches it instead of renaming it.
      const deskIcon = { ...desk, y: Number(desk.y) + 0.055 };
      await clickObservation(deskIcon);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await clickObservation(deskIcon);
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
  await selectBrunswickTab();
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
  if (screenState !== "feed") {
    const health = await recoverScreen(screenState, observations, options);
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
