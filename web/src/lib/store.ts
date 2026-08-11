import path from "path";
import { randomUUID } from "crypto";
import {
  isValidEntryId,
  normalizeWaitlistRow,
  statusForDb,
  waitlistInsertSnake,
} from "./db-mapper";
import { getSupabaseAdmin, hasSupabaseConfigured } from "./supabase";
import { defaultSessionMinutesFor } from "./booking";
import { getLiveLaneAvailability } from "./live-lane-availability";
import {
  activityQueueWait,
  type ResourceLaneAvailability,
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

/** Vercel / Cloudflare Workers — no durable local filesystem. */
function isServerlessHost(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.CF_PAGES ||
      process.env.CLOUDFLARE ||
      typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !==
        "undefined",
  );
}

async function getFs() {
  return import("fs/promises");
}

// --- File fallback (local Next.js only) ---

async function readFileAll(): Promise<WaitlistEntry[]> {
  if (isServerlessHost()) return [];
  try {
    const fs = await getFs();
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as WaitlistEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileAll(entries: WaitlistEntry[]): Promise<void> {
  if (isServerlessHost()) throw new Error("STORAGE_NOT_CONFIGURED");
  const fs = await getFs();
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
    notificationCount: db.notification_count,
    joinSmsStatus: db.join_sms_status ?? undefined,
    joinSmsSid: db.join_sms_sid ?? undefined,
    joinSmsErrorCode: db.join_sms_error_code ?? undefined,
    joinSmsAt: db.join_sms_at ?? undefined,
    lastSmsStatus: db.last_sms_status ?? undefined,
    lastSmsSid: db.last_sms_sid ?? undefined,
    lastSmsKind: db.last_sms_kind ?? undefined,
    lastSmsErrorCode: db.last_sms_error_code ?? undefined,
    lastSmsAt: db.last_sms_at ?? undefined,
    smsConsentAt: db.sms_consent_at ?? undefined,
    smsConsentSource: db.sms_consent_source ?? undefined,
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

  if (isServerlessHost()) throw new Error("STORAGE_NOT_CONFIGURED");
  return sanitizeStaleEntries(await readFileAll());
}

async function writeAllUnsafe(entries: WaitlistEntry[]): Promise<void> {
  if (getSupabaseAdmin()) {
    throw new Error("USE_ROW_OPERATIONS");
  }
  if (isServerlessHost()) throw new Error("STORAGE_NOT_CONFIGURED");
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
      displayName: "Guest",
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
    const patch: Record<string, string> = {
      status,
      updatedAt: new Date().toISOString(),
    };
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
  name: string;
  position: number;
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
  if (isServerlessHost()) {
    return {
      backend: "none",
      canWrite: false,
      hint: "Add Supabase env vars and run supabase/schema.sql.",
    };
  }
  return { backend: "file", canWrite: true };
}

export async function getStats(): Promise<ActivityStats[]> {
  const entries = await withStoreLock(readAllUnsafe);
  const liveLanes = await getLiveLaneAvailability();
  return ACTIVITIES.map((activity) =>
    buildStats(activity, entries, liveLanes[activity]),
  );
}

function buildStats(
  activity: Activity,
  entries: WaitlistEntry[],
  lanes?: ResourceLaneAvailability[],
): ActivityStats {
  const waiting = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  return {
    activity,
    label: ACTIVITY_LABELS[activity],
    waitingCount: waiting.length,
    estimatedWaitMinutes: activityQueueWait(activity, entries, lanes),
  };
}

export async function getBoard(): Promise<ActivityBoard[]> {
  const entries = await withStoreLock(readAllUnsafe);
  const liveLanes = await getLiveLaneAvailability();
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
      stats: buildStats(activity, entries, liveLanes[activity]),
      queue: waiting.map((e, i) => ({
        id: e.id,
        name: e.name,
        position: i + 1,
        status: e.status,
        laneCount: e.laneCount,
        sessionMinutes: e.sessionMinutes,
      })),
    };
  });
}

export async function getStaffQueues(): Promise<
  { activity: Activity; queue: WaitlistEntry[] }[]
> {
  const entries = await withStoreLock(readAllUnsafe);
  return ACTIVITIES.map((activity) => ({
    activity,
    queue: entries
      .filter((e) => e.activity === activity)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
  }));
}

export async function getEstimatedWaitMinutes(id: string): Promise<number> {
  const entries = await withStoreLock(readAllUnsafe);
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.status !== "waiting") return 0;
  const liveLanes = await getLiveLaneAvailability();
  return waitMinutesAhead(entries, entry, liveLanes[entry.activity]);
}

export async function getPosition(
  id: string,
): Promise<{ entry: WaitlistEntry; position: number } | null> {
  const entries = await withStoreLock(readAllUnsafe);
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  if (
    entry.status === "served" ||
    entry.status === "cancelled" ||
    entry.status === "archived"
  ) {
    return null;
  }

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
  smsConsentSource?: string;
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
      sessionMinutes:
        input.sessionMinutes ?? defaultSessionMinutesFor(input.activity),
      status: "waiting",
      createdAt: new Date().toISOString(),
      notificationCount: 0,
      ...(input.smsOptIn
        ? {
            smsConsentAt: new Date().toISOString(),
            smsConsentSource: input.smsConsentSource ?? "unspecified",
          }
        : {}),
    };

    return insertEntry(entry, customerId);
  });
}

export type WaitlistSmsKind = "join" | "notify" | "update";

export interface WaitlistSmsAttempt {
  accepted: boolean;
  sid?: string;
  status: string;
  errorCode?: string;
}

export async function recordSmsAttempt(
  id: string,
  kind: WaitlistSmsKind,
  attempt: WaitlistSmsAttempt,
): Promise<WaitlistEntry | null> {
  return withStoreLock(async () => {
    const now = new Date().toISOString();
    const entries = await readAllUnsafe();
    const existing = entries.find((entry) => entry.id === id);
    if (!existing) return null;

    const nextCount =
      kind === "notify"
        ? (existing.notificationCount ?? 0) + 1
        : existing.notificationCount ?? 0;
    const common = {
      last_sms_sid: attempt.sid ?? null,
      last_sms_status: attempt.status,
      last_sms_kind: kind,
      last_sms_error_code: attempt.errorCode ?? null,
      last_sms_at: now,
      notification_count: nextCount,
      updatedAt: now,
    };
    const patch =
      kind === "join"
        ? {
            ...common,
            join_sms_sid: attempt.sid ?? null,
            join_sms_status: attempt.status,
            join_sms_error_code: attempt.errorCode ?? null,
            join_sms_at: now,
          }
        : common;

    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .update(patch)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) {
        logSupabaseError("record sms", error);
        throw error;
      }
      return data ? rowToEntry(data as Record<string, unknown>) : null;
    }

    const index = entries.findIndex((entry) => entry.id === id);
    entries[index] = {
      ...entries[index],
      notificationCount: nextCount,
      lastSmsStatus: attempt.status,
      lastSmsSid: attempt.sid,
      lastSmsKind: kind,
      lastSmsErrorCode: attempt.errorCode,
      lastSmsAt: now,
      ...(kind === "join"
        ? {
            joinSmsStatus: attempt.status,
            joinSmsSid: attempt.sid,
            joinSmsErrorCode: attempt.errorCode,
            joinSmsAt: now,
          }
        : {}),
    };
    await writeAllUnsafe(entries);
    return entries[index];
  });
}

export async function recordSmsDelivery(
  messageSid: string,
  status: string,
  errorCode?: string,
): Promise<boolean> {
  return withStoreLock(async () => {
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data: rows, error: readError } = await supabase
        .from("waitlist_entries")
        .select("id,join_sms_sid,last_sms_sid")
        .or(`join_sms_sid.eq.${messageSid},last_sms_sid.eq.${messageSid}`)
        .limit(1);
      if (readError) throw readError;
      const row = rows?.[0] as
        | { id: string; join_sms_sid?: string; last_sms_sid?: string }
        | undefined;
      if (!row) return false;
      const patch: Record<string, string | null> = {
        updatedAt: new Date().toISOString(),
      };
      if (row.join_sms_sid === messageSid) {
        patch.join_sms_status = status;
        patch.join_sms_error_code = errorCode ?? null;
      }
      if (row.last_sms_sid === messageSid) {
        patch.last_sms_status = status;
        patch.last_sms_error_code = errorCode ?? null;
      }
      const { error } = await supabase
        .from("waitlist_entries")
        .update(patch)
        .eq("id", row.id);
      if (error) throw error;
      return true;
    }

    const entries = await readFileAll();
    const index = entries.findIndex(
      (entry) =>
        entry.joinSmsSid === messageSid || entry.lastSmsSid === messageSid,
    );
    if (index === -1) return false;
    entries[index] = {
      ...entries[index],
      lastSmsStatus: status,
      lastSmsErrorCode: errorCode,
    };
    await writeFileAll(entries);
    return true;
  });
}

export async function updateStatus(
  id: string,
  status: WaitlistStatus,
): Promise<WaitlistEntry | null> {
  return withStoreLock(() => patchEntryStatus(id, status));
}

export async function confirmSmsConsent(
  id: string,
  source = "staff-resend-confirmation-v1",
): Promise<WaitlistEntry | null> {
  return withStoreLock(async () => {
    const consentAt = new Date().toISOString();
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .update({
          sms_opt_in: true,
          sms_consent_at: consentAt,
          sms_consent_source: source,
          updatedAt: consentAt,
        })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data ? rowToEntry(data as Record<string, unknown>) : null;
    }

    const entries = await readFileAll();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    entries[index] = {
      ...entries[index],
      smsOptIn: true,
      smsConsentAt: consentAt,
      smsConsentSource: source,
    };
    await writeFileAll(entries);
    return entries[index];
  });
}

export async function updateEntryDetails(
  id: string,
  input: {
    phone: string;
    laneCount: LaneCount;
    sessionMinutes: SessionDuration;
  },
): Promise<WaitlistEntry | null> {
  return withStoreLock(async () => {
    const normalizedPhone = normalizePhone(input.phone);
    const entries = await readAllUnsafe();
    const existing = entries.find((entry) => entry.id === id);
    if (!existing) return null;
    const duplicate = entries.find(
      (entry) =>
        entry.id !== id &&
        entry.activity === existing.activity &&
        entry.phone === normalizedPhone &&
        (entry.status === "waiting" || entry.status === "notified"),
    );
    if (duplicate) throw new Error("ALREADY_ON_WAITLIST");

    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .update({
          phone: normalizedPhone,
          partySize: input.laneCount,
          estimated_wait_minutes: input.sessionMinutes,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) {
        logSupabaseError("edit", error);
        throw error;
      }
      return data ? rowToEntry(data as Record<string, unknown>) : null;
    }

    const index = entries.findIndex((entry) => entry.id === id);
    entries[index] = {
      ...entries[index],
      phone: normalizedPhone,
      laneCount: input.laneCount,
      sessionMinutes: input.sessionMinutes,
    };
    await writeAllUnsafe(entries);
    return entries[index];
  });
}

/** Undo accidental serve/remove, or re-text a notified guest. */
export async function recallEntry(
  id: string,
): Promise<{ entry: WaitlistEntry; resentSms: boolean } | null> {
  return withStoreLock(async () => {
    const entries = await readAllUnsafe();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    if (entry.status === "notified") {
      return { entry, resentSms: false };
    }

    if (entry.status === "served" || entry.status === "cancelled") {
      const restored = await patchEntryStatus(id, "waiting");
      if (!restored) return null;
      return { entry: restored, resentSms: false };
    }

    return null;
  });
}

export async function getEntryById(id: string): Promise<WaitlistEntry | null> {
  const entries = await withStoreLock(readAllUnsafe);
  return entries.find((e) => e.id === id) ?? null;
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

/** Hide served/cancelled party from the recall strip into the searchable archive. */
export async function archiveEntry(id: string): Promise<WaitlistEntry | null> {
  return withStoreLock(async () => {
    const entries = await readAllUnsafe();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    if (entry.status !== "served" && entry.status !== "cancelled") {
      return null;
    }
    return patchEntryStatus(id, "archived");
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
