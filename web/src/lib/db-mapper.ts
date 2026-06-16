import {
  normalizeLaneCount,
  normalizeSessionMinutes,
} from "./booking";
import type {
  Activity,
  LaneCount,
  SessionDuration,
  WaitlistStatus,
} from "./types";

/** Normalize Supabase rows from snake_case or legacy camelCase / enum columns. */
export function normalizeWaitlistRow(
  row: Record<string, unknown>,
): {
  id: string;
  customer_id: string | null;
  activity: Activity;
  name: string;
  phone: string;
  sms_opt_in: boolean;
  lane_count: LaneCount;
  session_minutes: SessionDuration;
  status: WaitlistStatus;
  created_at: string;
  notified_at: string | null;
} {
  const rawStatus = row.status ?? row.Status;
  const rawActivity = row.activity ?? row.Activity;

  const status = String(rawStatus ?? "waiting").toLowerCase() as WaitlistStatus;
  const activity = String(rawActivity ?? "bowling").toLowerCase() as Activity;

  const created =
    row.created_at ??
    row.createdAt ??
    row.joined_at ??
    row.joinedAt ??
    row.inserted_at ??
    row.insertedAt;

  const notified = row.notified_at ?? row.notifiedAt ?? null;

  const name = String(
    row.name ??
      row.displayName ??
      row.Name ??
      row.guestName ??
      row.guest_name ??
      "",
  ).trim();

  const partySize = Number(row.partySize ?? row.party_size ?? 1);
  const laneCount = normalizeLaneCount(activity, partySize) as LaneCount;

  const rawSession = Number(
    row.session_minutes ??
      row.sessionMinutes ??
      row.estimated_wait_minutes ??
      30,
  );
  const sessionMinutes = normalizeSessionMinutes(
    activity,
    rawSession,
  ) as SessionDuration;

  return {
    id: String(row.id),
    customer_id: (row.customer_id ?? row.customerId ?? null) as string | null,
    activity,
    name: name || "Guest",
    phone: String(row.phone ?? row.Phone ?? ""),
    sms_opt_in: Boolean(row.sms_opt_in ?? row.smsOptIn ?? false),
    lane_count: laneCount,
    session_minutes: sessionMinutes,
    status,
    created_at: created ? String(created) : new Date().toISOString(),
    notified_at: notified ? String(notified) : null,
  };
}

export function waitlistInsertSnake(
  entry: {
    id: string;
    activity: string;
    name: string;
    phone: string;
    smsOptIn: boolean;
    laneCount: number;
    sessionMinutes: number;
    status: string;
    createdAt: string;
  },
  customerId: string | null,
) {
  const now = entry.createdAt;
  return {
    id: entry.id,
    publicToken: entry.id,
    customer_id: customerId,
    activity: entry.activity,
    displayName: "Guest",
    partySize: entry.laneCount,
    estimated_wait_minutes: entry.sessionMinutes,
    name: entry.name,
    phone: entry.phone,
    sms_opt_in: entry.smsOptIn,
    status: entry.status,
    created_at: now,
    updatedAt: now,
  };
}

export function waitlistInsertCamel(
  entry: {
    id: string;
    activity: string;
    name: string;
    phone: string;
    smsOptIn: boolean;
    status: string;
    createdAt: string;
  },
  customerId: string | null,
) {
  return {
    id: entry.id,
    publicToken: entry.id,
    customerId,
    activity: entry.activity,
    name: entry.name,
    phone: entry.phone,
    smsOptIn: entry.smsOptIn,
    status: entry.status,
    createdAt: entry.createdAt,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidEntryId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Map app status to legacy enum labels if the DB still uses WaitlistStatus. */
export function statusForDb(status: string): string[] {
  const lower = status.toLowerCase();
  const title = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([lower, title, lower.toUpperCase()])];
}
