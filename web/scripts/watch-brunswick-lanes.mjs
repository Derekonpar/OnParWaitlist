#!/usr/bin/env node
import { execFile } from "node:child_process";
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
const remoteSessionId = "62496004-47a6-fec6-9a79-d08dadefdf70";

const laneLayout = [
  { lane: 1, x: 0.133, y: 0.784 },
  { lane: 2, x: 0.185, y: 0.784 },
  { lane: 3, x: 0.238, y: 0.784 },
  { lane: 4, x: 0.291, y: 0.784 },
  { lane: 5, x: 0.344, y: 0.784 },
  { lane: 6, x: 0.396, y: 0.784 },
  { lane: 7, x: 0.449, y: 0.784 },
  { lane: 8, x: 0.502, y: 0.784 },
  { lane: 9, x: 0.133, y: 0.701 },
  { lane: 10, x: 0.185, y: 0.701 },
  { lane: 11, x: 0.238, y: 0.701 },
  { lane: 12, x: 0.291, y: 0.701 },
];

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
    interval: 5,
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
  --interval 5              Seconds between captures
  --base-url URL            Staff app URL, default NEXT_PUBLIC_APP_URL
  --secret SECRET           Staff secret, default STAFF_SECRET
  --screenshot PATH         Parse an existing screenshot instead of capturing Chrome

The watcher selects the open Brunswick Google Remote Desktop tab, takes a
screenshot, OCRs the visible lane timers, and posts the latest lane snapshot.`);
}

function parseTimer(text) {
  const match = text.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes > 59) return null;
  return (hours * 60 + minutes) * 60;
}

function laneFromText(text) {
  const match = text.match(/\bLane\s*(\d{1,2})\b/i);
  if (!match) return null;
  const lane = Number(match[1]);
  return lane >= 1 && lane <= 12 ? lane : null;
}

function nearestLayoutLane(obs) {
  let best = null;
  for (const layout of laneLayout) {
    const dx = Math.abs(obs.x - layout.x);
    const dy = Math.abs(obs.y - layout.y);
    const score = dx + dy * 2.5;
    if (dy <= 0.018 && dx <= 0.04 && (!best || score < best.score)) {
      best = { ...layout, score };
    }
  }
  return best?.lane ?? null;
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
    .map((obs) => ({
      ...obs,
      remainingSeconds: parseTimer(String(obs.text ?? "")),
    }))
    .filter((obs) => obs.remainingSeconds !== null);

  for (const obs of timed) {
    const text = String(obs.text ?? "");
    const lane = laneFromText(text);
    if (!lane) continue;

    lanes[lane - 1] = {
      lane,
      status: "occupied",
      remainingSeconds: obs.remainingSeconds,
      rawText: text.slice(0, 100),
      confidence: Number(obs.confidence ?? 0),
    };
  }

  for (const obs of timed) {
    const text = String(obs.text ?? "");
    if (laneFromText(text)) continue;

    const lane = nearestLayoutLane(obs);
    if (!lane || lanes[lane - 1].status === "occupied") continue;

    lanes[lane - 1] = {
      lane,
      status: "occupied",
      remainingSeconds: obs.remainingSeconds,
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
  return `${occupied.length ? occupied.join(", ") : "no timers"}; ${openCount} open`;
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
      if (title of t contains "Brunswick") or (URL of t contains "${remoteSessionId}") then
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

async function captureScreenshot() {
  await selectBrunswickTab();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const dir = await mkdtemp(path.join(tmpdir(), "brunswick-lanes-"));
  const screenshotPath = path.join(dir, "screen.png");
  await execFileAsync("screencapture", ["-x", screenshotPath]);
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

async function captureAndPost(options) {
  const screenshotPath = options.screenshot ?? (await captureScreenshot());
  const capturedAt = options.screenshot
    ? (await stat(screenshotPath)).mtime.toISOString()
    : new Date().toISOString();
  const observations = await runOcr(screenshotPath);
  const lanes = extractLanes(observations);

  if (!options.dryRun) {
    await postSnapshot({
      baseUrl: options.baseUrl,
      secret: options.secret,
      lanes,
      capturedAt,
    });
  }

  const prefix = options.dryRun ? "dry-run" : "posted";
  console.log(`${new Date().toLocaleTimeString()} ${prefix}: ${summarizeLanes(lanes)}`);
  return lanes;
}

loadEnvFile(path.join(appDir, ".dev.vars"));
loadEnvFile(path.join(appDir, ".env.production.local"));
loadEnvFile(path.join(appDir, ".env.local"));

const args = readArgs();
const options = {
  ...args,
  interval: Number.isFinite(args.interval) && args.interval > 0 ? args.interval : 5,
  baseUrl:
    args.baseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://onparwaitlist.com",
  secret: args.secret ?? process.env.STAFF_SECRET,
};

if (!options.secret && !options.dryRun) {
  throw new Error("Missing STAFF_SECRET. Set it in .dev.vars or pass --secret.");
}

await captureAndPost(options);

while (!options.once) {
  await new Promise((resolve) => setTimeout(resolve, options.interval * 1000));
  try {
    await captureAndPost({ ...options, screenshot: undefined });
  } catch (error) {
    console.error(`${new Date().toLocaleTimeString()} watcher error: ${error.message}`);
  }
}
