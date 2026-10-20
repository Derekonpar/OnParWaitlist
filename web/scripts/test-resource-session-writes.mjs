import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
// Execute the real TypeScript modules with explicit service boundaries. The
// installed PostgREST client generates requests; no hosted credentials are read.
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  new Script(`(function(require,module,exports){${compiled}\n})`, { filename: path })
    .runInThisContext()(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const sessionId = "e10e144d-a177-4ee1-b3d6-f736e1535902";
const row = {
  session_id: sessionId, resource_type: "pool", resource_id: "red", guest_name: "Fictional",
  starts_at: "2026-10-20T20:00:00.000Z", ends_at: "2026-10-20T21:00:00.000Z", duration_minutes: 60,
};
const input = { resourceType: "pool", resourceId: "red", guestName: "Fictional", startsAt: row.starts_at, durationMinutes: 60 };
function setup(responder, { authorized = true, schedule = { fetchedAt: new Date().toISOString(), reservations: [] } } = {}) {
  const requests = [];
  const client = createClient("https://example.supabase.co", "fake-local-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const call = { url: new URL(url), method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined };
      requests.push(call);
      return responder(call);
    } },
  });
  const storage = load("../src/lib/resource-sessions.ts", { "./supabase": { getSupabaseAdmin: () => client } });
  const route = load("../src/app/api/staff/resource-sessions/route.ts", {
    "@/lib/auth": { verifyStaffSecret: () => authorized },
    "@/lib/resource-sessions": storage,
    "@/lib/entertainment-schedule": { getStoredEntertainmentSchedule: async () => schedule },
    "@/lib/reservation-policy": load("../src/lib/reservation-policy.ts"),
  });
  return { storage, route, requests };
}
const request = (method, body) => new Request("https://example.test/api/staff/resource-sessions", {
  method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
});

test("new checkout uses a plain insert and returns its database identity", async () => {
  const { storage, requests } = setup(() => Response.json(row));
  assert.equal((await storage.saveTimedResourceSession(input)).sessionId, sessionId);
  assert.equal(requests.length, 1);
  const call = requests[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url.pathname, "/rest/v1/activity_resource_sessions");
  assert.equal(call.url.searchParams.has("on_conflict"), false);
  assert.doesNotMatch(call.headers.get("Prefer"), /resolution=/);
  assert.equal(Object.hasOwn(call.body, "session_id"), false, "identity must be assigned by the database");
  assert.equal(call.body.ends_at, row.ends_at);
  assert.match(call.url.searchParams.get("select"), /session_id/);
});

test("duplicate resource returns a sanitized conflict with no overwrite/retry", async () => {
  const { route, requests } = setup(() => Response.json({ code: "23505", message: "private guest detail" }, { status: 409 }));
  const response = await route.POST(request("POST", input));
  assert.equal(response.status, 409);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private guest detail/);
  assert.deepEqual(requests.map((r) => r.method), ["POST"]);
});

test("clear is conditional on both physical resource and exact observed session", async () => {
  const { storage, requests } = setup(() => Response.json([{ session_id: sessionId }]));
  await storage.clearTimedResourceSession("pool", "red", sessionId);
  assert.equal(requests[0].method, "DELETE");
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), {
    resource_type: "eq.pool", resource_id: "eq.red", session_id: `eq.${sessionId}`, select: "session_id",
  });
});

test("zero-row stale clear returns conflict and never falls back to resource-only deletion", async () => {
  const { route, requests } = setup(() => Response.json([]));
  const response = await route.DELETE(request("DELETE", { resourceType: "pool", resourceId: "red", sessionId }));
  assert.equal(response.status, 409);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get("session_id"), `eq.${sessionId}`);
});

test("old or malformed clear requests are rejected before database access", async () => {
  const { route, requests } = setup(() => { throw new Error("Unexpected request"); });
  for (const id of [undefined, "", "not-a-uuid"]) {
    const response = await route.DELETE(request("DELETE", { resourceType: "pool", resourceId: "red", sessionId: id }));
    assert.equal(response.status, 400);
  }
  assert.equal(requests.length, 0);
});

test("stored sessions without migrated identities are not accepted", async () => {
  const { storage } = setup(() => Response.json([{ ...row, session_id: undefined }]));
  await assert.rejects(storage.getTimedResourceSessions(), /IDENTITY_MISSING/);
});

test("unconfigured storage never advertises an empty resource session list", async () => {
  const storage = load("../src/lib/resource-sessions.ts", { "./supabase": { getSupabaseAdmin: () => null } });
  await assert.rejects(storage.getTimedResourceSessions(), /STORAGE_NOT_CONFIGURED/);
});

test("a missing migration or database failure does not activate an unguarded fallback", async () => {
  for (const code of ["42703", "42501", "08006"]) {
    const { storage, requests } = setup(() => Response.json({ code, message: "private failure" }, { status: 400 }));
    await assert.rejects(storage.saveTimedResourceSession(input), (error) => error.code === code);
    assert.equal(requests.length, 1);
  }
});

test("network uncertainty never retries the mutation", async () => {
  const { storage, requests } = setup(() => { throw new Error("network interrupted"); });
  await assert.rejects(storage.saveTimedResourceSession(input));
  assert.equal(requests.length, 1);
});

test("staff authentication is required for all resource-session operations", async () => {
  const { route, requests } = setup(() => { throw new Error("Unexpected request"); }, { authorized: false });
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal((await route[method](request(method, method === "GET" ? undefined : input))).status, 401);
  }
  assert.equal(requests.length, 0);
});

test("missing, stale, invalid and future schedule evidence cannot start a session", async () => {
  for (const schedule of [null, { fetchedAt: "invalid", reservations: [] },
    { fetchedAt: new Date(Date.now() - 180000).toISOString(), reservations: [] },
    { fetchedAt: new Date(Date.now() + 60000).toISOString(), reservations: [] }]) {
    const { route, requests } = setup(() => { throw new Error("Unexpected request"); }, { schedule });
    assert.equal((await route.POST(request("POST", input))).status, 503);
    assert.equal(requests.length, 0);
  }
});

test("existing event protection and invalid reservation clocks prevent a conflicting start", async () => {
  for (const [startAt, endAt] of [
    ["2026-10-20T21:30:00Z", "2026-10-20T22:00:00Z"], // one-hour protection overlaps
    ["invalid", "2026-10-20T22:00:00Z"],
    ["2026-10-20T22:00:00Z", "2026-10-20T21:30:00Z"],
  ]) {
    const { route, requests } = setup(() => { throw new Error("Unexpected request"); }, {
      schedule: { fetchedAt: new Date().toISOString(), reservations: [{ resourceId: "pool-1", eventName: "Fictional event", startAt, endAt }] },
    });
    assert.equal((await route.POST(request("POST", input))).status, 409);
    assert.equal(requests.length, 0);
  }
});
