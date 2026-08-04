import { getSupabaseAdmin } from "./supabase";
import type { ResourceLaneAvailability } from "./resource-scheduler";

export type TimedResourceType = "pool" | "shuffleboard";

export interface TimedResourceSession {
  resourceType: TimedResourceType;
  resourceId: string;
  guestName: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: 60 | 120;
}

export const TIMED_RESOURCES: Record<
  TimedResourceType,
  { id: string; label: string }[]
> = {
  pool: [
    { id: "red", label: "Red pool table" },
    { id: "green", label: "Green pool table" },
    { id: "blue", label: "Blue pool table" },
  ],
  shuffleboard: [
    { id: "1", label: "Shuffleboard 1" },
    { id: "2", label: "Shuffleboard 2" },
  ],
};

function rowToSession(row: Record<string, unknown>): TimedResourceSession {
  return {
    resourceType: row.resource_type as TimedResourceType,
    resourceId: String(row.resource_id),
    guestName: String(row.guest_name),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    durationMinutes: Number(row.duration_minutes) as 60 | 120,
  };
}

export async function getTimedResourceSessions(): Promise<
  TimedResourceSession[]
> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("activity_resource_sessions")
    .select("resource_type,resource_id,guest_name,starts_at,ends_at,duration_minutes")
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
  durationMinutes: 60 | 120;
}): Promise<TimedResourceSession> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(
    startsAt.getTime() + input.durationMinutes * 60 * 1000,
  );
  const { data, error } = await supabase
    .from("activity_resource_sessions")
    .upsert(
      {
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        guest_name: input.guestName.trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        duration_minutes: input.durationMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "resource_type,resource_id" },
    )
    .select("resource_type,resource_id,guest_name,starts_at,ends_at,duration_minutes")
    .single();
  if (error) throw error;
  return rowToSession(data);
}

export async function clearTimedResourceSession(
  resourceType: TimedResourceType,
  resourceId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");
  const { error } = await supabase
    .from("activity_resource_sessions")
    .delete()
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId);
  if (error) throw error;
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
