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
  hasCompleteActivityAvailability,
  hasCompleteTargetAvailability,
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
const ACTIVE_WAITLIST_STATUSES = [
  ...statusForDb("waiting"),
  ...statusForDb("notified"),
];
const ACTIVE_ENTRY_SELECT =
  "id,activity,name,status,created_at,partySize,estimated_wait_minutes";
const STAFF_ARCHIVE_SELECT =
  "id,activity,name,phone,status,created_at,partySize,estimated_wait_minutes";
const STAFF_RECENT_HISTORY_LIMIT = 40;
const STAFF_ARCHIVE_PAGE_SIZE = 25;
const STAFF_ARCHIVE_MAX_PAGE_SIZE = 50;

let localFileStoreLock: Promise<unknown> = Promise.resolve();

function withLocalFileFallbackLock<T>(fn: () => Promise<T>): Promise<T> {
  // Supabase provides its own concurrency controls. A serverless request with
  // missing storage must also fail independently instead of queuing behind an
  // unrelated request's promise.
  if (getSupabaseAdmin() || isServerlessHost()) return fn();

  // The local fallback uses read-modify-write JSON operations. Serialize only
  // those filesystem paths so concurrent local mutations cannot overwrite one
  // another. Reads also pass through here because readAllUnsafe may purge a
  // stale legacy row from the local file.
  const run = localFileStoreLock.then(fn, fn);
  localFileStoreLock = run.catch(() => {});
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
  if (isServerlessHost()) throw new Error("STORAGE_NOT_CONFIGURED");
  return sanitizeStaleEntries(await readFileAll());
}

/**
 * Public wait calculations need only active queue rows and scheduling fields.
 * Keep phone, consent, SMS delivery, customer, and historical rows out of the
 * high-frequency board/status payload read from Supabase.
 */
async function readActiveEntriesUnsafe(): Promise<WaitlistEntry[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("waitlist_entries")
      .select(ACTIVE_ENTRY_SELECT)
      .in("status", ACTIVE_WAITLIST_STATUSES)
      .order("created_at", { ascending: true });
    if (error) {
      logSupabaseError("read active", error);
      throw error;
    }
    return sanitizeStaleEntries(
      (data ?? []).map((row) => rowToEntry(row as Record<string, unknown>)),
    );
  }

  const entries = await readAllUnsafe();
  return entries.filter(
    (entry) => entry.status === "waiting" || entry.status === "notified",
  );
}

async function readEntryByIdUnsafe(id: string): Promise<WaitlistEntry | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("waitlist_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      logSupabaseError("read entry", error);
      throw error;
    }
    return data ? rowToEntry(data as Record<string, unknown>) : null;
  }

  const entries = await readAllUnsafe();
  return entries.find((entry) => entry.id === id) ?? null;
}

/**
 * Staff refreshes happen every 15 seconds, so keep that hot path bounded:
 * every active guest plus only the newest served/removed entries used by the
 * recall strip. Archived history is loaded separately when staff open it.
 */
async function readStaffQueueEntriesUnsafe(): Promise<WaitlistEntry[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const activeStatuses = [
      ...statusForDb("waiting"),
      ...statusForDb("notified"),
    ];
    const historyStatuses = [
      ...statusForDb("served"),
      ...statusForDb("cancelled"),
    ];
    const [activeResult, historyResult] = await Promise.all([
      supabase
        .from("waitlist_entries")
        .select("*")
        .in("status", activeStatuses)
        .order("created_at", { ascending: true }),
      supabase
        .from("waitlist_entries")
        .select("*")
        .in("status", historyStatuses)
        .order("created_at", { ascending: false })
        .limit(STAFF_RECENT_HISTORY_LIMIT),
    ]);
    if (activeResult.error) {
      logSupabaseError("read staff active", activeResult.error);
      throw activeResult.error;
    }
    if (historyResult.error) {
      logSupabaseError("read staff recent history", historyResult.error);
      throw historyResult.error;
    }
    const activeEntries = await sanitizeStaleEntries(
      (activeResult.data ?? []).map((row) =>
        rowToEntry(row as Record<string, unknown>),
      ),
    );
    const historyEntries = (historyResult.data ?? []).map((row) =>
      rowToEntry(row as Record<string, unknown>),
    );
    return [...activeEntries, ...historyEntries];
  }

  const entries = await readAllUnsafe();
  const activeEntries = entries.filter(
    (entry) => entry.status === "waiting" || entry.status === "notified",
  );
  const historyEntries = entries
    .filter(
      (entry) => entry.status === "served" || entry.status === "cancelled",
    )
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    )
    .slice(0, STAFF_RECENT_HISTORY_LIMIT);
  return [...activeEntries, ...historyEntries];
}

export type StaffArchiveEntry = Pick<
  WaitlistEntry,
  "id" | "activity" | "name" | "phone" | "status" | "createdAt"
>;

function toStaffArchiveEntry(entry: WaitlistEntry): StaffArchiveEntry {
  return {
    id: entry.id,
    activity: entry.activity,
    name: entry.name,
    phone: entry.phone,
    status: entry.status,
    createdAt: entry.createdAt,
  };
}

export interface StaffArchivePage {
  entries: StaffArchiveEntry[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Read a single bounded page of archived guests for the on-demand staff UI. */
export async function getStaffArchivePage(options: {
  query?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<StaffArchivePage> {
  const query = options.query?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(
    STAFF_ARCHIVE_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? STAFF_ARCHIVE_PAGE_SIZE)),
  );
  const offset = (page - 1) * pageSize;
  const supabase = getSupabaseAdmin();

  if (supabase) {
    let request = supabase
      .from("waitlist_entries")
      .select(STAFF_ARCHIVE_SELECT)
      .in("status", statusForDb("archived"))
      .order("created_at", { ascending: false });
    if (query) request = request.ilike("name", `%${query}%`);
    const { data, error } = await request.range(offset, offset + pageSize);
    if (error) {
      logSupabaseError("read staff archive", error);
      throw error;
    }
    const rows = (data ?? []).map((row) =>
      toStaffArchiveEntry(rowToEntry(row as Record<string, unknown>)),
    );
    return {
      entries: rows.slice(0, pageSize),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }

  return withLocalFileFallbackLock(async () => {
    const normalizedQuery = query.toLowerCase();
    const entries = (await readAllUnsafe())
      .filter((entry) => entry.status === "archived")
      .filter(
        (entry) =>
          !normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery),
      )
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
    const rows = entries.slice(offset, offset + pageSize + 1);
    return {
      entries: rows.slice(0, pageSize).map(toStaffArchiveEntry),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  });
}

async function hasActiveDuplicateUnsafe(
  activity: Activity,
  phone: string,
  excludeId?: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let request = supabase
      .from("waitlist_entries")
      .select("id")
      .eq("activity", activity)
      .eq("phone", phone)
      .in("status", ACTIVE_WAITLIST_STATUSES);
    if (excludeId) request = request.neq("id", excludeId);
    const { data, error } = await request.limit(1);
    if (error) {
      logSupabaseError("duplicate check", error);
      throw error;
    }
    return Boolean(data?.length);
  }

  const entries = await readAllUnsafe();
  return entries.some(
    (entry) =>
      entry.id !== excludeId &&
      entry.activity === activity &&
      entry.phone === phone &&
      (entry.status === "waiting" || entry.status === "notified"),
  );
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
  const [entries, liveLanes] = await Promise.all([
    withLocalFileFallbackLock(readActiveEntriesUnsafe),
    getLiveLaneAvailability({ refreshRemote: false }),
  ]);
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
    availabilityStatus: hasCompleteActivityAvailability(activity, entries, lanes)
      ? "live"
      : "unknown",
  };
}

export async function getBoard(): Promise<ActivityBoard[]> {
  const [entries, liveLanes] = await Promise.all([
    withLocalFileFallbackLock(readActiveEntriesUnsafe),
    getLiveLaneAvailability({ refreshRemote: false }),
  ]);
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
  const entries = await withLocalFileFallbackLock(readStaffQueueEntriesUnsafe);
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
  const entries = await withLocalFileFallbackLock(readActiveEntriesUnsafe);
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.status !== "waiting") return 0;
  const liveLanes = await getLiveLaneAvailability({ refreshRemote: false });
  return waitMinutesAhead(entries, entry, liveLanes[entry.activity]);
}

function getPositionFromEntries(
  entries: WaitlistEntry[],
  id: string,
): { entry: WaitlistEntry; position: number } | null {
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

export async function getPosition(
  id: string,
): Promise<{ entry: WaitlistEntry; position: number } | null> {
  const entries = await withLocalFileFallbackLock(readActiveEntriesUnsafe);
  return getPositionFromEntries(entries, id);
}

export interface WaitlistStatusSnapshot {
  entry: WaitlistEntry;
  position: number;
  estimatedWaitMinutes: number;
  availabilityStatus: "live" | "unknown";
}

/**
 * Read a guest status from one queue snapshot. The previous route loaded the
 * entire queue once for position and again for its estimate, then blocked on
 * remote live feeds. This keeps both values internally consistent and uses
 * only shared last-known-good lane data.
 */
export async function getWaitlistStatus(
  id: string,
): Promise<WaitlistStatusSnapshot | null> {
  const [entries, liveLanes] = await Promise.all([
    withLocalFileFallbackLock(readActiveEntriesUnsafe),
    getLiveLaneAvailability({ refreshRemote: false }),
  ]);
  const result = getPositionFromEntries(entries, id);
  if (!result) return null;
  const estimatedWaitMinutes = result.entry.status === "waiting"
    ? waitMinutesAhead(
        entries,
        result.entry,
        liveLanes[result.entry.activity],
      )
    : 0;
  const availabilityStatus = hasCompleteTargetAvailability(
    entries,
    result.entry,
    liveLanes[result.entry.activity],
  )
    ? "live"
    : "unknown";
  return { ...result, estimatedWaitMinutes, availabilityStatus };
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
  return withLocalFileFallbackLock(async () => {
    const normalizedPhone = normalizePhone(input.phone);
    if (await hasActiveDuplicateUnsafe(input.activity, normalizedPhone)) {
      throw new Error("ALREADY_ON_WAITLIST");
    }

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
  return withLocalFileFallbackLock(async () => {
    const now = new Date().toISOString();
    const supabase = getSupabaseAdmin();
    let fileEntries: WaitlistEntry[] | null = null;
    let fileIndex = -1;
    let notificationCount = 0;

    if (supabase) {
      const { data: existing, error: readError } = await supabase
        .from("waitlist_entries")
        .select("notification_count")
        .eq("id", id)
        .maybeSingle();
      if (readError) {
        logSupabaseError("read sms count", readError);
        throw readError;
      }
      if (!existing) return null;
      notificationCount = Math.max(
        0,
        Number(existing.notification_count ?? 0) || 0,
      );
    } else {
      fileEntries = await readAllUnsafe();
      fileIndex = fileEntries.findIndex((entry) => entry.id === id);
      if (fileIndex === -1) return null;
      notificationCount = fileEntries[fileIndex].notificationCount ?? 0;
    }

    const nextCount =
      kind === "notify"
        ? notificationCount + 1
        : notificationCount;
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

    if (!fileEntries || fileIndex < 0) return null;
    fileEntries[fileIndex] = {
      ...fileEntries[fileIndex],
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
    await writeAllUnsafe(fileEntries);
    return fileEntries[fileIndex];
  });
}

export async function recordSmsDelivery(
  messageSid: string,
  status: string,
  errorCode?: string,
): Promise<boolean> {
  return withLocalFileFallbackLock(async () => {
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
  return withLocalFileFallbackLock(() => patchEntryStatus(id, status));
}

export async function confirmSmsConsent(
  id: string,
  source = "staff-resend-confirmation-v1",
): Promise<WaitlistEntry | null> {
  return withLocalFileFallbackLock(async () => {
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
  return withLocalFileFallbackLock(async () => {
    const normalizedPhone = normalizePhone(input.phone);
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const existing = await readEntryByIdUnsafe(id);
      if (!existing) return null;
      if (
        await hasActiveDuplicateUnsafe(
          existing.activity,
          normalizedPhone,
          id,
        )
      ) {
        throw new Error("ALREADY_ON_WAITLIST");
      }
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
  return withLocalFileFallbackLock(async () => {
    const entry = await readEntryByIdUnsafe(id);
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
  return withLocalFileFallbackLock(() => readEntryByIdUnsafe(id));
}

/** Remove from queue — works for valid UUIDs (cancel) or legacy invalid ids (delete). */
export async function removeEntry(id: string): Promise<boolean> {
  return withLocalFileFallbackLock(async () => {
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
  return withLocalFileFallbackLock(async () => {
    const entry = await readEntryByIdUnsafe(id);
    if (!entry) return null;
    if (entry.status !== "served" && entry.status !== "cancelled") {
      return null;
    }
    return patchEntryStatus(id, "archived");
  });
}

export async function cancelActiveEntriesForPhone(phone: string): Promise<number> {
  return withLocalFileFallbackLock(async () => {
    const normalized = normalizePhone(phone);
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .update({
          status: "cancelled",
          updatedAt: new Date().toISOString(),
        })
        .eq("phone", normalized)
        .in("status", ACTIVE_WAITLIST_STATUSES)
        .select("id");
      if (error) {
        logSupabaseError("cancel phone entries", error);
        throw error;
      }
      return data?.length ?? 0;
    }

    const entries = await readAllUnsafe();
    let count = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (
        entry.phone === normalized &&
        (entry.status === "waiting" || entry.status === "notified")
      ) {
        entries[index] = { ...entry, status: "cancelled" };
        count++;
      }
    }
    if (count > 0) await writeAllUnsafe(entries);
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
