import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { displayName } from "./display";
import {
  isValidEntryId,
  normalizeWaitlistRow,
  statusForDb,
  waitlistInsertSnake,
} from "./db-mapper";
import { getSupabaseAdmin, hasSupabaseConfigured } from "./supabase";
import {
  activityQueueWait,
  waitMinutesAhead,
} from "./wait-estimate";
import {
  ACTIVITIES,
  type Activity,
  type ActivityStats,
  ACTIVITY_LABELS,
  type LaneCount,
  type SessionDuration,
  type WaitlistEntry,
  type WaitlistStatus,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "waitlist.json");

let storeLock: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn, fn);
  storeLock = run.catch(() => {});
  return run;
}

function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

// --- File fallback (local dev only) ---

async function readFileAll(): Promise<WaitlistEntry[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as WaitlistEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(entries: WaitlistEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(entries, null, 2), "utf-8");
  await fs.rename(temp, DATA_FILE);
}

// --- Supabase row mapping ---

function rowToEntry(row: Record<string, unknown>): WaitlistEntry {
  const db = normalizeWaitlistRow(row);
  return {
    id: db.id,
    customerId: db.customer_id ?? undefined,
    activity: db.activity,
    name: db.name,
    phone: db.phone,
    smsOptIn: db.sms_opt_in,
    laneCount: db.lane_count,
    sessionMinutes: db.session_minutes,
    status: db.status,
    createdAt: db.created_at,
    notifiedAt: db.notified_at ?? undefined,
  };
}

async function deleteEntryById(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from("waitlist_entries").delete().eq("id", id);
    return;
  }
  const entries = await readFileAll();
  await writeFileAll(entries.filter((e) => e.id !== id));
}

async function sanitizeStaleEntries(
  entries: WaitlistEntry[],
): Promise<WaitlistEntry[]> {
  const kept: WaitlistEntry[] = [];
  for (const entry of entries) {
    const isActive =
      entry.status === "waiting" || entry.status === "notified";
    if (isActive && !isValidEntryId(entry.id)) {
      await deleteEntryById(entry.id);
      console.warn("[store] removed stale entry", entry.name, entry.id);
      continue;
    }
    kept.push(entry);
  }
  return kept;
}

function sortByCreatedAt(rows: WaitlistEntry[]): WaitlistEntry[] {
  return [...rows].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function logSupabaseError(context: string, error: { message: string; code?: string; details?: string; hint?: string }) {
  console.error(`[store:${context}]`, error.message, error.code, error.details, error.hint);
}

async function upsertCustomer(
  name: string,
  phone: string,
  rewardsOptIn: boolean,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data: existing } = await supabase
    .from("customers")
    .select("id, visit_count, rewards_opt_in")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("customers")
      .update({
        name,
        last_seen_at: new Date().toISOString(),
        visit_count: (existing.visit_count ?? 0) + 1,
        rewards_opt_in: existing.rewards_opt_in || rewardsOptIn,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      phone,
      name,
      rewards_opt_in: rewardsOptIn,
    })
    .select("id")
    .single();

  if (error) throw error;
  return created.id;
}

async function readAllUnsafe(): Promise<WaitlistEntry[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from("waitlist_entries").select("*");
    if (error) {
      logSupabaseError("read", error);
      throw error;
    }
    const entries = sortByCreatedAt(
      (data ?? []).map((row) => rowToEntry(row as Record<string, unknown>)),
    );
    return sanitizeStaleEntries(entries);
  }

  if (isVercel()) throw new Error("STORAGE_NOT_CONFIGURED");
  return sanitizeStaleEntries(await readFileAll());
}

async function writeAllUnsafe(entries: WaitlistEntry[]): Promise<void> {
  if (getSupabaseAdmin()) {
    throw new Error("USE_ROW_OPERATIONS");
  }
  if (isVercel()) throw new Error("STORAGE_NOT_CONFIGURED");
  await writeFileAll(entries);
}

async function supabaseInsertEntry(
  entry: WaitlistEntry,
  customerId: string | null,
): Promise<WaitlistEntry> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");

  const attempts: Record<string, unknown>[] = [
    waitlistInsertSnake(entry, customerId),
    {
      id: entry.id,
      publicToken: entry.id,
      customer_id: customerId,
      activity: entry.activity,
      displayName: displayName(entry.name),
      partySize: entry.laneCount,
      estimated_wait_minutes: entry.sessionMinutes,
      name: entry.name,
      phone: entry.phone,
      status: entry.status,
      updatedAt: entry.createdAt,
    },
  ];

  let lastError: { message: string; code?: string } | null = null;
  for (const base of attempts) {
    for (const status of statusForDb(entry.status)) {
      const payload = { ...base, status };
      const result = await supabase
        .from("waitlist_entries")
        .insert(payload as never)
        .select("*")
        .single();
      if (!result.error && result.data) {
        return rowToEntry(result.data as Record<string, unknown>);
      }
      if (result.error) {
        lastError = result.error;
        logSupabaseError("insert", result.error);
      }
    }
  }

  if (lastError) throw lastError;
  throw new Error("INSERT_FAILED");
}

async function insertEntry(
  entry: WaitlistEntry,
  customerId: string | null,
): Promise<WaitlistEntry> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    return supabaseInsertEntry(entry, customerId);
  }

  const entries = await readFileAll();
  entries.push(entry);
  await writeFileAll(entries);
  return entry;
}

async function patchEntryStatus(
  id: string,
  status: WaitlistStatus,
): Promise<WaitlistEntry | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const patch: Record<string, string> = { status };
    if (status === "notified") patch.notified_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("waitlist_entries")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) {
      logSupabaseError("patch", error);
      throw error;
    }
    return data ? rowToEntry(data as Record<string, unknown>) : null;
  }

  const entries = await readFileAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entries[idx] = {
    ...entries[idx],
    status,
    ...(status === "notified"
      ? { notifiedAt: new Date().toISOString() }
      : {}),
  };
  await writeFileAll(entries);
  return entries[idx];
}

// --- Public API ---

export interface QueuePreview {
  id: string;
  position: number;
  displayName: string;
  status: WaitlistStatus;
  laneCount: number;
  sessionMinutes: number;
}

export interface ActivityBoard {
  stats: ActivityStats;
  queue: QueuePreview[];
}

export async function getStorageStatus(): Promise<{
  backend: "supabase" | "file" | "none";
  canWrite: boolean;
  hint?: string;
}> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error: customersError } = await supabase
      .from("customers")
      .select("id")
      .limit(1);
    if (customersError) {
      return {
        backend: "supabase",
        canWrite: false,
        hint: `customers table: ${customersError.message}`,
      };
    }
    const { error: waitlistError } = await supabase
      .from("waitlist_entries")
      .select("id")
      .limit(1);
    if (waitlistError) {
      return {
        backend: "supabase",
        canWrite: false,
        hint: `waitlist_entries table: ${waitlistError.message}`,
      };
    }
    return { backend: "supabase", canWrite: true };
  }
  if (isVercel()) {
    return {
      backend: "none",
      canWrite: false,
      hint: "Add Supabase env vars in Vercel and run supabase/schema.sql.",
    };
  }
  return { backend: "file", canWrite: true };
}

export async function getStats(): Promise<ActivityStats[]> {
  const entries = await withStoreLock(readAllUnsafe);
  return ACTIVITIES.map((activity) => buildStats(activity, entries));
}

function buildStats(
  activity: Activity,
  entries: WaitlistEntry[],
): ActivityStats {
  const waiting = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  return {
    activity,
    label: ACTIVITY_LABELS[activity],
    waitingCount: waiting.length,
    estimatedWaitMinutes: activityQueueWait(activity, entries),
  };
}

export async function getBoard(): Promise<ActivityBoard[]> {
  const entries = await withStoreLock(readAllUnsafe);
  return ACTIVITIES.map((activity) => {
    const waiting = entries
      .filter(
        (e) =>
          e.activity === activity &&
          (e.status === "waiting" || e.status === "notified"),
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

    return {
      stats: buildStats(activity, entries),
      queue: waiting.map((e, i) => ({
        id: e.id,
        position: i + 1,
        displayName: displayName(e.name),
        status: e.status,
        laneCount: e.laneCount,
        sessionMinutes: e.sessionMinutes,
      })),
    };
  });
}

export async function getQueue(activity: Activity): Promise<WaitlistEntry[]> {
  const entries = await withStoreLock(readAllUnsafe);
  return entries
    .filter((e) => e.activity === activity && e.status !== "cancelled")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export async function getEstimatedWaitMinutes(id: string): Promise<number> {
  const entries = await withStoreLock(readAllUnsafe);
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.status !== "waiting") return 0;
  return waitMinutesAhead(entries, entry);
}

export async function getPosition(
  id: string,
): Promise<{ entry: WaitlistEntry; position: number } | null> {
  const entries = await withStoreLock(readAllUnsafe);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  if (entry.status === "served" || entry.status === "cancelled") return null;

  if (entry.status === "notified") {
    return { entry, position: 1 };
  }

  const ahead = entries.filter(
    (e) =>
      e.activity === entry.activity &&
      e.status === "waiting" &&
      new Date(e.createdAt).getTime() < new Date(entry.createdAt).getTime(),
  );
  return { entry, position: ahead.length + 1 };
}

export async function joinWaitlist(input: {
  activity: Activity;
  name: string;
  phone: string;
  smsOptIn: boolean;
  rewardsOptIn?: boolean;
  laneCount?: LaneCount;
  sessionMinutes?: SessionDuration;
}): Promise<WaitlistEntry> {
  return withStoreLock(async () => {
    const normalizedPhone = normalizePhone(input.phone);
    const entries = await readAllUnsafe();

    const duplicate = entries.find(
      (e) =>
        e.activity === input.activity &&
        e.phone === normalizedPhone &&
        (e.status === "waiting" || e.status === "notified"),
    );
    if (duplicate) throw new Error("ALREADY_ON_WAITLIST");

    const customerId = await upsertCustomer(
      input.name.trim(),
      normalizedPhone,
      input.rewardsOptIn ?? false,
    );

    const entry: WaitlistEntry = {
      id: randomUUID(),
      customerId: customerId ?? undefined,
      activity: input.activity,
      name: input.name.trim(),
      phone: normalizedPhone,
      smsOptIn: input.smsOptIn,
      laneCount: input.laneCount ?? 1,
      sessionMinutes: input.sessionMinutes ?? 30,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };

    return insertEntry(entry, customerId);
  });
}

export async function updateStatus(
  id: string,
  status: WaitlistStatus,
): Promise<WaitlistEntry | null> {
  return withStoreLock(() => patchEntryStatus(id, status));
}

/** Remove from queue — works for valid UUIDs (cancel) or legacy invalid ids (delete). */
export async function removeEntry(id: string): Promise<boolean> {
  return withStoreLock(async () => {
    if (isValidEntryId(id)) {
      const entry = await patchEntryStatus(id, "cancelled");
      return entry !== null;
    }
    await deleteEntryById(id);
    return true;
  });
}

export async function cancelActiveEntriesForPhone(phone: string): Promise<number> {
  return withStoreLock(async () => {
    const normalized = normalizePhone(phone);
    const entries = await readAllUnsafe();
    let count = 0;
    for (const e of entries) {
      if (
        e.phone === normalized &&
        (e.status === "waiting" || e.status === "notified")
      ) {
        await patchEntryStatus(e.id, "cancelled");
        count++;
      }
    }
    return count;
  });
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  if (digits.length >= 10) return `+${digits}`;
  throw new Error("INVALID_PHONE");
}

export { hasSupabaseConfigured };
