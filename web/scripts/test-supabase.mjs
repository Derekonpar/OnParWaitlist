/**
 * Integration test against live Supabase (uses .env.production.local).
 * Run: node scripts/test-supabase.mjs
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

function loadEnv(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i);
    let val = trimmed.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(".env.production.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("FAIL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(step, error) {
  console.error(`FAIL [${step}]:`, error.message ?? error);
  if (error.code) console.error("  code:", error.code);
  if (error.details) console.error("  details:", error.details);
  if (error.hint) console.error("  hint:", error.hint);
  process.exit(1);
}

console.log("1) customers select...");
{
  const { error } = await supabase.from("customers").select("id").limit(1);
  if (error) fail("customers select", error);
  console.log("   OK");
}

console.log("2) waitlist_entries select * (no order)...");
let existing = [];
{
  const { data, error } = await supabase.from("waitlist_entries").select("*");
  if (error) fail("waitlist_entries select", error);
  existing = data ?? [];
  console.log(`   OK (${existing.length} rows)`);
  if (existing[0]) {
    console.log("   sample columns:", Object.keys(existing[0]).join(", "));
  }
}

console.log("3) waitlist_entries order by created_at...");
{
  const { error } = await supabase
    .from("waitlist_entries")
    .select("id")
    .order("created_at", { ascending: true });
  if (error) fail("waitlist_entries order created_at", error);
  console.log("   OK");
}

const testId = randomUUID();
const testPhone = "+19375559999";
const testName = "Integration Test";

console.log("4) insert customer...");
let customerId;
{
  const { data, error } = await supabase
    .from("customers")
    .insert({ phone: testPhone, name: testName, rewards_opt_in: false })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", testPhone)
        .single();
      customerId = existingCustomer?.id;
      console.log("   OK (reused existing customer)");
    } else {
      fail("customers insert", error);
    }
  } else {
    customerId = data.id;
    console.log("   OK");
  }
}

console.log("5) insert waitlist_entries (snake_case)...");
const snakePayload = {
  id: testId,
  customer_id: customerId,
  activity: "bowling",
  name: testName,
  phone: testPhone,
  sms_opt_in: false,
  status: "waiting",
  created_at: new Date().toISOString(),
};
{
  const { data, error } = await supabase
    .from("waitlist_entries")
    .insert(snakePayload)
    .select("*")
    .single();
  if (error) {
    console.log("   snake_case failed:", error.message, error.code);
    console.log("6) retry insert (status=Waiting for enum)...");
    for (const status of ["waiting", "Waiting", "WAITING"]) {
      const { data: d2, error: e2 } = await supabase
        .from("waitlist_entries")
        .insert({ ...snakePayload, status })
        .select("*")
        .single();
      if (!e2) {
        console.log(`   OK with status=${status}`);
        break;
      }
      console.log(`   status=${status} failed:`, e2.message);
      if (status === "WAITING") fail("waitlist_entries insert", e2);
    }
  } else {
    console.log("   OK");
    console.log("   inserted columns:", Object.keys(data).join(", "));
  }
}

console.log("7) cleanup test row...");
{
  await supabase.from("waitlist_entries").delete().eq("id", testId);
  await supabase.from("customers").delete().eq("phone", testPhone);
  console.log("   OK");
}

console.log("\nALL TESTS PASSED");
