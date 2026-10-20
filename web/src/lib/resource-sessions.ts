import { getSupabaseAdmin } from "./supabase";
import type { ResourceLaneAvailability } from "./resource-scheduler";

export type TimedResourceType = "pool" | "shuffleboard";

export interface TimedResourceSession {
  sessionId: string;
  resourceType: TimedResourceType;
  resourceId: string;
  guestName: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: 30 | 60 | 120;
}

const SESSION_COLUMNS = "session_id,resource_type,resource_id,guest_name,starts_at,ends_at,duration_minutes";
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ResourceSessionConflict extends Error {
  constructor() {
    super("Resource session changed. Refresh before trying again.");
    this.name = "ResourceSessionConflict";
  }
}

export const TIMED_RESOURCES: Record<
  TimedResourceType,
  { id: string; label: string }[]
> = {
  pool: [
    { id: "red", label: "Red pool rack" },
    { id: "green", label: "Green pool rack" },
    { id: "blue", label: "Blue pool rack" },
  ],
  shuffleboard: [
    { id: "1", label: "Shuffleboard 1" },
    { id: "2", label: "Shuffleboard 2" },
  ],
};

function rowToSession(row: Record<string, unknown>): TimedResourceSession {
  if (typeof row.session_id !== "string" || !SESSION_ID_PATTERN.test(row.session_id)) {
    throw new Error("RESOURCE_SESSION_IDENTITY_MISSING");
  }
  return {
    sessionId: row.session_id,
    resourceType: row.resource_type as TimedResourceType,
    resourceId: String(row.resource_id),
    guestName: String(row.guest_name),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    durationMinutes: Number(row.duration_minutes) as 30 | 60 | 120,
  };
}

export async function getTimedResourceSessions(): Promise<
  TimedResourceSession[]
> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");
  const { data, error } = await supabase
    .from("activity_resource_sessions")
    .select(SESSION_COLUMNS)
    .order("resource_type")
    .order("resource_id");
  if (error) throw error;
  return (data ?? []).map((row) => rowToSession(row));
}

export async function saveTimedResourceSession(input: {
  resourceType: TimedResourceType;
  resourceId: string;
  guestName: string;
  startsAt: string;
  durationMinutes: 30 | 60 | 120;
}): Promise<TimedResourceSession> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(
    startsAt.getTime() + input.durationMinutes * 60 * 1000,
  );
  const { data, error } = await supabase
    .from("activity_resource_sessions")
    // The resource primary key decides the winner across server instances.
    // Never overwrite an existing session, even when its timer has ended:
    // staff must collect the equipment and clear that exact session first.
    .insert(
      {
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        guest_name: input.guestName.trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        duration_minutes: input.durationMinutes,
        updated_at: new Date().toISOString(),
      },
    )
    .select(SESSION_COLUMNS)
    .single();
  if (error?.code === "23505") throw new ResourceSessionConflict();
  if (error) throw error;
  return rowToSession(data);
}

export async function clearTimedResourceSession(
  resourceType: TimedResourceType,
  resourceId: string,
  sessionId: string,
): Promise<void> {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new ResourceSessionConflict();
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");
  const { data, error } = await supabase
    .from("activity_resource_sessions")
    .delete()
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .eq("session_id", sessionId)
    .select("session_id")
    .maybeSingle();
  if (error) throw error;
  if (!data || data.session_id !== sessionId) throw new ResourceSessionConflict();
}

export function timedSessionsToAvailability(
  resourceType: TimedResourceType,
  sessions: TimedResourceSession[],
  nowMs = Date.now(),
): ResourceLaneAvailability[] {
  return TIMED_RESOURCES[resourceType].map((resource) => {
    const session = sessions.find(
      (item) =>
        item.resourceType === resourceType && item.resourceId === resource.id,
    );
    if (!session) {
      return { id: resource.id, label: resource.label, availableAtSeconds: 0 };
    }
    const remaining = Math.ceil(
      (new Date(session.endsAt).getTime() - nowMs) / 1000,
    );
    return {
      id: resource.id,
      label: resource.label,
      // Allow five minutes for staff to retrieve equipment after time expires.
      availableAtSeconds: remaining > 0 ? remaining : 5 * 60,
    };
  });
}
