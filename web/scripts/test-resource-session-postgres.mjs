// Disposable loopback database only. Never reads DATABASE_URL or hosted secrets.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const probe = createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const directory = await mkdtemp(path.join(tmpdir(), "onpar-waitlist-pg-"));
const database = new EmbeddedPostgres({
  databaseDir: path.join(directory, "db"), user: "postgres", password: randomBytes(32).toString("hex"),
  port, persistent: false, postgresFlags: ["-h", "127.0.0.1", "-k", directory, "-c", "max_connections=10"],
  onLog() {}, onError() {},
});
const clients = [];
let passed = 0;
const observe = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const create = (client, guest = "Fictional", type = "pool", resource = "red") => client.query(
  `insert into activity_resource_sessions(resource_type,resource_id,guest_name,starts_at,ends_at,duration_minutes)
   values($1,$2,$3,'2026-10-01T20:00Z','2026-10-01T21:00Z',60) returning *`, [type, resource, guest],
);
const clear = (client, id, type = "pool", resource = "red") => client.query(
  "delete from activity_resource_sessions where resource_type=$1 and resource_id=$2 and session_id=$3 returning session_id",
  [type, resource, id],
);
try {
  await database.initialise();
  await database.start();
  for (let i = 0; i < 4; i++) {
    const client = database.getPgClient("postgres", "127.0.0.1");
    clients.push(client);
    await client.connect();
    await client.query("set statement_timeout='8s'");
    client.pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid;
  }
  const [admin, first, second, blocker] = clients;
  assert.equal(new Set(clients.map((c) => c.pid)).size, 4);
  console.log(`Isolated PostgreSQL ${(await admin.query("show server_version")).rows[0].server_version}; four connections`);
  const inspectionSql = await readFile(new URL("../../supabase/inspect_resource_session_baseline.sql", import.meta.url), "utf8");
  const inspect = async () => {
    const results = await admin.query(inspectionSql);
    const report = results.find((result) => result.rows[0]?.report)?.rows[0].report;
    assert.ok(report);
    assert.equal(report.transactionReadOnly, "on");
    assert.equal(report.mayApply, false);
    assert.equal(report.requiresOwnerReview, true);
    assert.equal((await admin.query("show transaction_read_only")).rows[0].transaction_read_only, "off");
    return report;
  };
  await admin.query("create schema decoy; create table decoy.activity_resource_sessions(secret text); set search_path=decoy,public");
  const absent = await inspect();
  assert.equal(absent.exists, false, "a search-path shadow is not the public session table");
  assert.deepEqual(absent.columns, []);
  assert.deepEqual(absent.constraints, []);
  assert.deepEqual(absent.apiRolePrivileges, []);
  assert.equal(absent.migrationHistoryRelationExists, false);
  await admin.query("set search_path=public; drop schema decoy cascade");
  console.log("PASS baseline inspection handles absent tables/history and ignores search-path shadows"); passed++;

  const schema = await readFile(new URL("../../supabase/add_activity_resource_sessions.sql", import.meta.url), "utf8");
  const legacySchema = schema.replace(/^  session_id uuid[^\n]*\n/m, "");
  assert.notEqual(legacySchema, schema);
  await admin.query(legacySchema);
  await create(admin, "Existing guest");
  const before = (await admin.query("select * from activity_resource_sessions")).rows[0];
  const legacy = await inspect();
  assert.equal(legacy.exists, true);
  assert.equal(legacy.relationKind, "r");
  assert.equal(legacy.rowSecurityEnabled, false);
  assert.ok(!legacy.columns.some((column) => column.name === "session_id"));
  assert.ok(legacy.constraints.some((constraint) => constraint.type === "p" && constraint.definition === "PRIMARY KEY (resource_type, resource_id)"));
  assert.deepEqual((await admin.query("select * from activity_resource_sessions")).rows[0], before);
  assert.ok(!JSON.stringify(legacy).includes("Existing guest"));
  console.log("PASS baseline inspection reports the legacy schema without reading or changing occupancy"); passed++;

  await admin.query(await readFile(new URL("../../supabase/migrations/20261020205626_timed_resource_session_identity.sql", import.meta.url), "utf8"));
  const { session_id: migratedId, ...after } = (await admin.query("select * from activity_resource_sessions")).rows[0];
  assert.match(migratedId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(after, before, "migration must preserve existing occupancy and clocks");
  console.log("PASS migration assigns identity without changing existing occupancy"); passed++;

  await admin.query("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[]); insert into supabase_migrations.schema_migrations values ('fixture', array['PRIVATE_HISTORY_SENTINEL'])");
  const current = await inspect();
  assert.equal(current.migrationHistoryRelationExists, true);
  assert.ok(current.columns.some((column) => column.name === "session_id" && column.type === "uuid" && column.notNull && column.default === "gen_random_uuid()"));
  assert.ok(current.constraints.some((constraint) => constraint.definition === "UNIQUE (session_id)" && constraint.validated));
  assert.ok(current.indexes.some((index) => index.unique && index.valid && index.ready && index.definition.includes("(session_id)")));
  assert.ok(!JSON.stringify(current).includes("PRIVATE_HISTORY_SENTINEL"));
  console.log("PASS baseline inspection reports identity constraints/indexes without exporting history SQL"); passed++;

  await admin.query("create role anon; grant usage on schema public to anon; grant update (ends_at) on activity_resource_sessions to anon; alter table activity_resource_sessions enable row level security; create policy fixture_read on activity_resource_sessions for select to anon using (true)");
  const privileges = await inspect();
  assert.equal(privileges.rowSecurityEnabled, true);
  assert.equal(privileges.apiRolePrivileges[0].role, "anon");
  assert.equal(privileges.apiRolePrivileges[0].updateAnyColumn, true);
  assert.equal(privileges.apiRolePrivileges[0].insertAnyColumn, false);
  assert.equal(privileges.apiRolePrivileges[0].delete, false);
  assert.equal(privileges.policies[0].name, "fixture_read");
  assert.deepEqual(privileges.policies[0].roles, ["anon"]);
  await admin.query("drop policy fixture_read on activity_resource_sessions; alter table activity_resource_sessions disable row level security; revoke all on activity_resource_sessions from anon; revoke update (ends_at) on activity_resource_sessions from anon; revoke usage on schema public from anon; drop role anon");
  console.log("PASS baseline inspection exposes column grants and RLS policies separately"); passed++;

  const attemptWrite = inspectionSql.replace(/rollback;\s*$/i,
    "delete from public.activity_resource_sessions; rollback;");
  assert.notEqual(attemptWrite, inspectionSql);
  await assert.rejects(admin.query(attemptWrite), (error) => error.code === "25006");
  await admin.query("rollback");
  assert.equal((await admin.query("select session_id from activity_resource_sessions")).rows[0].session_id, migratedId);
  assert.equal((await admin.query("select count(*) from supabase_migrations.schema_migrations")).rows[0].count, "1");
  console.log("PASS diagnostic transaction rejects writes and preserves sessions/history"); passed++;

  const waitForLock = async (...waiting) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = (await admin.query("select pid from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [waiting.map((c) => c.pid)])).rows;
      if (rows.length === waiting.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("contenders did not reach the database lock");
  };
  const reset = async () => {
    for (const client of [first, second, blocker]) await client.query("rollback");
    await admin.query("truncate activity_resource_sessions");
  };
  const scenario = async (name, run) => { await reset(); await run(); console.log(`PASS ${name}`); passed++; };

  await scenario("simultaneous starts have one winner and cannot overwrite it", async () => {
    await blocker.query("begin; lock table activity_resource_sessions in exclusive mode");
    const a = observe(create(first, "First contender"));
    const b = observe(create(second, "Second contender"));
    await waitForLock(first, second);
    await blocker.query("commit");
    const outcomes = await Promise.all([a, b]);
    assert.equal(outcomes.filter((o) => o.value).length, 1);
    assert.equal(outcomes.find((o) => o.error).error.code, "23505");
    const winner = outcomes.find((o) => o.value).value.rows[0];
    const rows = (await admin.query("select * from activity_resource_sessions")).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], winner);
  });

  await scenario("ended timers remain occupied until the exact checkout is cleared", async () => {
    const old = (await create(first, "Equipment not collected")).rows[0];
    await assert.rejects(create(second, "New guest"), (error) => error.code === "23505");
    assert.equal((await clear(first, old.session_id)).rowCount, 1);
    const current = (await create(second, "New guest")).rows[0];
    assert.notEqual(current.session_id, old.session_id);
  });

  await scenario("stale and wrong-resource clears cannot delete a replacement", async () => {
    const old = (await create(first)).rows[0];
    await clear(first, old.session_id);
    const current = (await create(second)).rows[0];
    assert.equal((await clear(first, old.session_id)).rowCount, 0);
    assert.equal((await clear(first, current.session_id, "pool", "blue")).rowCount, 0);
    assert.equal((await admin.query("select session_id from activity_resource_sessions")).rows[0].session_id, current.session_id);
  });

  await scenario("a stale clear waiting on replacement rechecks the identity after commit", async () => {
    const old = (await create(admin)).rows[0];
    await first.query("begin");
    await clear(first, old.session_id);
    const replacement = (await create(first, "Replacement")).rows[0];
    const staleClear = observe(clear(second, old.session_id));
    await waitForLock(second);
    await first.query("commit");
    const outcome = await staleClear;
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.value.rowCount, 0);
    assert.equal((await admin.query("select session_id from activity_resource_sessions")).rows[0].session_id, replacement.session_id);
  });

  await scenario("simultaneous clears acknowledge exactly one deletion", async () => {
    const old = (await create(admin)).rows[0];
    await blocker.query("begin; select * from activity_resource_sessions for update");
    const a = observe(clear(first, old.session_id));
    const b = observe(clear(second, old.session_id));
    await waitForLock(first, second);
    await blocker.query("commit");
    const results = await Promise.all([a, b]);
    assert.ok(results.every((r) => !r.error));
    assert.deepEqual(results.map((r) => r.value.rowCount).sort(), [0, 1]);
  });

  await scenario("a lost create response cannot lead to a second checkout or overwrite", async () => {
    const original = (await create(first, "Committed guest")).rows[0];
    await assert.rejects(create(second, "Retry guest"), (error) => error.code === "23505");
    assert.equal((await admin.query("select session_id from activity_resource_sessions")).rows[0].session_id, original.session_id);
  });
  console.log(`${passed} PostgreSQL inspection/migration/concurrency scenarios passed`);
} finally {
  for (const client of clients) { try { await client.query("rollback"); await client.end(); } catch {} }
  try { await database.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
}
