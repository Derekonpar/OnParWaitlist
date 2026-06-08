import { displayName } from "./display";
import type { Activity, WaitlistStatus } from "./types";

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

  return {
    id: String(row.id),
    customer_id: (row.customer_id ?? row.customerId ?? null) as string | null,
    activity,
    name: name || "Guest",
    phone: String(row.phone ?? row.Phone ?? ""),
    sms_opt_in: Boolean(row.sms_opt_in ?? row.smsOptIn ?? false),
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
    displayName: displayName(entry.name),
    partySize: 1,
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

/** Map app status to legacy enum labels if the DB still uses WaitlistStatus. */
export function statusForDb(status: string): string[] {
  const lower = status.toLowerCase();
  const title = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([lower, title, lower.toUpperCase()])];
}
