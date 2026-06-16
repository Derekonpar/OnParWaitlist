/**
 * End-to-end test against a running waitlist deployment.
 * Run: node scripts/test-live.mjs [baseUrl]
 */
const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const testPhone = `937555${String(Date.now()).slice(-4)}`;

function fail(msg, detail) {
  console.error("FAIL:", msg);
  if (detail) console.error(detail);
  process.exit(1);
}

async function json(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

console.log(`Testing ${base}\n`);

console.log("1) GET /api/waitlist/board");
{
  const { res, body } = await json("/api/waitlist/board");
  if (!res.ok) fail(`board returned ${res.status}`, JSON.stringify(body));
  if (!Array.isArray(body.board) || body.board.length !== 4) {
    fail("board shape invalid", JSON.stringify(body));
  }
  console.log("   OK");
}

console.log("2) POST /api/waitlist/join");
let entryId;
{
  const { res, body } = await json("/api/waitlist/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      activity: "bowling",
      firstName: "Live",
      lastName: "Test",
      phone: testPhone,
      smsOptIn: false,
      rewardsOptIn: false,
      laneCount: 2,
      sessionMinutes: 60,
    }),
  });
  if (!res.ok) fail(`join returned ${res.status}`, JSON.stringify(body));
  entryId = body.entry?.id;
  if (!entryId) fail("join missing entry.id", JSON.stringify(body));
  console.log(`   OK (id ${entryId}, position ${body.position})`);
}

console.log("3) GET /api/waitlist/status/:id");
{
  const { res, body } = await json(`/api/waitlist/status/${entryId}`);
  if (!res.ok) fail(`status returned ${res.status}`, JSON.stringify(body));
  console.log(`   OK (position ${body.position})`);
}

console.log("4) POST join with SMS opt-in (must succeed even if Twilio fails)");
{
  const smsPhone = `937556${String(Date.now()).slice(-4)}`;
  const { res, body } = await json("/api/waitlist/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      activity: "pool",
      firstName: "SMS",
      lastName: "OptIn",
      phone: smsPhone,
      smsOptIn: true,
      rewardsOptIn: false,
      laneCount: 1,
      sessionMinutes: 30,
    }),
  });
  if (!res.ok) fail(`sms join returned ${res.status}`, JSON.stringify(body));
  if (!body.entry?.id) fail("sms join missing entry.id", JSON.stringify(body));
  console.log(`   OK (smsSent=${body.smsSent})`);
}

console.log("5) board shows new guest");
{
  const { res, body } = await json("/api/waitlist/board");
  if (!res.ok) fail(`board refresh ${res.status}`, JSON.stringify(body));
  const bowling = body.board.find((b) => b.stats.activity === "bowling");
  if (!bowling?.queue?.some((q) => q.position >= 1)) {
    fail("guest not visible on board", JSON.stringify(bowling));
  }
  const pool = body.board.find((b) => b.stats.activity === "pool");
  if (!pool?.queue?.length) {
    fail("sms guest not visible on board", JSON.stringify(pool));
  }
  if (bowling.queue.some((q) => q.displayName)) {
    fail("public board must not expose names", JSON.stringify(bowling.queue[0]));
  }
  console.log("   OK");
}

console.log("\nALL LIVE TESTS PASSED");
