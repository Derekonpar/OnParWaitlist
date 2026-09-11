import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`;
const envUrl = moduleUrl(source("../src/lib/env.ts"));
const configUrl = moduleUrl(source("../src/lib/public-display-override.server.ts")
  .replace('import "server-only";', "")
  .replace('from "./env"', `from "${envUrl}"`));
const { isPublicBowlingNoWaitOverrideEnabled } = await import(configUrl);
const setting = "PUBLIC_BOWLING_NO_WAIT_OVERRIDE";
const before = process.env[setting];
try {
  delete process.env[setting];
  assert.equal(isPublicBowlingNoWaitOverrideEnabled(), false);
  for (const value of ["", "false", "TRUE", "1", "yes", " true "]) {
    process.env[setting] = value;
    assert.equal(isPublicBowlingNoWaitOverrideEnabled(), false, `Disabled for ${JSON.stringify(value)}`);
  }
  process.env[setting] = "true";
  assert.equal(isPublicBowlingNoWaitOverrideEnabled(), true);
  process.env[setting] = "false";
  assert.equal(isPublicBowlingNoWaitOverrideEnabled(), false, "Reads runtime changes rather than capturing build-time state");
} finally {
  if (before === undefined) delete process.env[setting];
  else process.env[setting] = before;
}

const require = createRequire(import.meta.url);
const compiled = new Map();
function componentUrl(file) {
  if (compiled.has(file.href)) return compiled.get(file.href);
  let text = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  text = text.replace(/from "([^"]+)"/g, (_, specifier) => {
    let resolved;
    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const base = specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}`, import.meta.url) : new URL(specifier, file);
      const child = [".ts", ".tsx"].map((extension) => new URL(`${base.href}${extension}`)).find((candidate) => existsSync(candidate));
      assert.ok(child, `Dependency exists: ${specifier}`);
      resolved = componentUrl(child);
    } else resolved = pathToFileURL(require.resolve(specifier)).href;
    return `from "${resolved}"`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
  compiled.set(file.href, url);
  return url;
}
const { ActivityCard } = await import(componentUrl(new URL("../src/components/ActivityCard.tsx", import.meta.url)));
const { TvWaitBoard } = await import(componentUrl(new URL("../src/components/TvWaitBoard.tsx", import.meta.url)));
const nowMs = Date.now();
const boardItem = (activity, availabilityStatus = "unknown") => ({
  stats: { activity, label: activity === "bowling" ? "Bowling" : "Darts", waitingCount: 1, estimatedWaitMinutes: 85,
    availabilityStatus, availabilityExpiresAt: new Date(nowMs - 1).toISOString(), reservationScheduleStatus: "stale" },
  queue: [{ id: "synthetic-only", name: "Synthetic Queue Guest", position: 1, status: "waiting", laneCount: 2, sessionMinutes: 60 }],
});
for (const availabilityStatus of ["live", "estimated", "unknown"]) {
  const item = boardItem("bowling", availabilityStatus);
  const unchanged = structuredClone(item);
  const html = renderToStaticMarkup(React.createElement(ActivityCard, {
    board: item, onJoin: () => {}, nowMs, bowlingNoWaitOverride: true,
  }));
  assert.match(html, /No Wait/);
  assert.match(html, /Available/);
  assert.match(html, /Current status/);
  assert.match(html, /Synthetic Queue Guest/);
  assert.match(html, /Currently waiting/);
  assert.match(html, /Get on waitlist/);
  assert.doesNotMatch(html, /Updating|Reconnecting|Last confirmed estimate|~85/);
  assert.deepEqual(item, unchanged, "Rendering never changes stats, expiry, queue or requested duration");
}
const renderCard = (activity, override) => renderToStaticMarkup(React.createElement(ActivityCard, {
  board: boardItem(activity), onJoin: () => {}, nowMs, bowlingNoWaitOverride: override,
}));
assert.match(renderCard("bowling", false), /Check with staff/);
assert.match(renderCard("bowling", undefined), /Check with staff/, "Default is off");
assert.match(renderCard("darts", true), /Updating/, "Other activities remain truthful");
assert.doesNotMatch(renderCard("darts", true), /No Wait/);

const tvBoard = [boardItem("bowling"), boardItem("darts")];
const tvBefore = structuredClone(tvBoard);
const tvHtml = (enabled) => renderToStaticMarkup(React.createElement(TvWaitBoard, {
  initialBoard: tvBoard, initialBowlingNoWaitOverride: enabled,
}));
const articles = (html) => html.match(/<article[\s\S]*?<\/article>/g);
const onArticles = articles(tvHtml(true));
assert.match(onArticles[0], /No Wait/);
assert.doesNotMatch(onArticles[0], /Updating/);
assert.match(onArticles[0], /Synthetic Queue Guest/);
assert.match(onArticles[0], /<ol[\s\S]*?>1<\/span>/, "Numbered queue remains above summary");
assert.ok(onArticles[0].indexOf("data-tv-queue-preview") < onArticles[0].indexOf("data-tv-wait-summary"));
assert.match(onArticles[1], /Check with staff/, "Unknown darts is not overridden to No Wait");
assert.doesNotMatch(tvHtml(false), /updating|connecting|reconnecting/i, "The rendered TV page has no refresh/error wording");
assert.match(articles(tvHtml(false))[0], /Check with staff/, "Rollback restores source-anchored expiry");
assert.deepEqual(tvBoard, tvBefore);

// Exercise the actual board GET body with read-only stubs: success, timeout and
// errors must carry the separate switch, never manufacture new lane/queue data.
const routeSource = source("../src/app/api/waitlist/board/route.ts").replace(/^import .*;\n/gm, "");
const routeModule = await import(moduleUrl(`
  let mode = "ok", enabled = true;
  const originalBoard = ${JSON.stringify(tvBoard)};
  const getBoard = () => mode === "timeout" ? new Promise(() => {}) : mode === "error" ? Promise.reject(new Error("synthetic")) : Promise.resolve(originalBoard);
  const emptyBoard = () => [];
  const after = () => {};
  const refreshLiveLaneSources = () => {};
  const isPublicBowlingNoWaitOverrideEnabled = () => enabled;
  const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200, headers: init?.headers }) };
  const console = { error: () => {} };
  const setTimeout = (callback) => globalThis.setTimeout(callback, 0);
  export function configure(nextMode, nextEnabled) { mode = nextMode; enabled = nextEnabled; }
  ${routeSource}
`));
for (const [mode, expectedStatus] of [["ok", 200], ["timeout", 503], ["error", 500]]) {
  for (const enabled of [true, false]) {
    routeModule.configure(mode, enabled);
    const response = await routeModule.GET();
    assert.equal(response.status, expectedStatus);
    assert.equal(response.body.bowlingNoWaitOverride, enabled);
    assert.equal(response.headers["cache-control"], "no-store");
    if (mode === "ok") assert.deepEqual(response.body.board, tvBefore);
  }
}
const staffSource = source("../src/app/api/staff/bowling-lanes/route.ts");
const staffGet = staffSource.slice(staffSource.indexOf("export async function GET("), staffSource.indexOf("export async function POST("));
const staffModule = await import(moduleUrl(`
  let reads = 0;
  const verifyStaffSecret = (request) => request.authorized === true;
  const getBowlingLaneSnapshot = async () => { reads++; return { healthStatus: "error", lanes: [{ lane: 1, status: "unknown" }] }; };
  const isPublicBowlingNoWaitOverrideEnabled = () => true;
  const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };
  export const readCount = () => reads;
  ${staffGet}
`));
assert.equal((await staffModule.GET({ authorized: false })).status, 401);
assert.equal(staffModule.readCount(), 0);
const staff = await staffModule.GET({ authorized: true });
assert.equal(staff.body.bowlingNoWaitOverride, undefined, "Real lane endpoint remains independent of public override");
assert.deepEqual(staff.body.snapshot, { healthStatus: "error", lanes: [{ lane: 1, status: "unknown" }] });
assert.doesNotMatch(staffSource.slice(staffSource.indexOf("export async function POST(")), /Override/);
const staffQueueSource = source("../src/app/api/staff/queue/route.ts").replace(/^import .*;\n/gm, "");
const staffQueueModule = await import(moduleUrl(`
  let reads = 0;
  const verifyStaffSecret = (request) => request.authorized === true;
  const getStaffQueues = async () => { reads++; return ${JSON.stringify(tvBoard)}; };
  const isPublicBowlingNoWaitOverrideEnabled = () => true;
  const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };
  export const readCount = () => reads;
  ${staffQueueSource}
`));
assert.equal((await staffQueueModule.GET({ authorized: false })).status, 401);
assert.equal(staffQueueModule.readCount(), 0);
const staffQueue = await staffQueueModule.GET({ authorized: true });
assert.equal(staffQueue.body.bowlingNoWaitOverride, true);
assert.deepEqual(staffQueue.body.queues, tvBefore, "Authenticated queues are unchanged");
for (const file of ["store.ts", "live-lane-availability.ts", "bowling-planner.ts", "resource-scheduler.ts", "bowling-lanes.ts"]) {
  assert.doesNotMatch(source(`../src/lib/${file}`), /PUBLIC_BOWLING_NO_WAIT_OVERRIDE|bowlingNoWaitOverride|isPublicBowlingNoWaitOverrideEnabled/);
}
for (const file of ["WaitlistDashboard.tsx", "TvWaitBoard.tsx"]) {
  const text = source(`../src/components/${file}`);
  assert.match(text, /setBowlingNoWaitOverride\(data\.bowlingNoWaitOverride === true\)/);
  assert.ok(text.indexOf("setBowlingNoWaitOverride(data.") < text.indexOf("throw new Error(\""), "Read override before rejecting a failed board response");
}
assert.match(source("../src/app/staff/page.tsx"), /Public bowling display override active/);
console.log("Public bowling display override passed: default-off runtime toggle, home/TV render + numbered queues, unchanged other activities/stats, rollback, API 200/503/500, staff auth and actual snapshots, no planner/control wiring.");
