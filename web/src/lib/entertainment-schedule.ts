import { readEnv } from "./env";
import { getSupabaseAdmin } from "./supabase";
import type { Activity } from "./types";
import type {
  ResourceLaneAvailability,
  ResourceUnavailableWindow,
} from "./resource-scheduler";
import {
  RESERVATION_PROTECTION_MS,
  reservationBlocksAvailability,
} from "./reservation-policy";

export interface EntertainmentReservation {
  id: string;
  operatingDate: string;
  eventId: string | null;
  eventName: string;
  resourceId: string;
  resourceName: string;
  resourceCategory: string;
  startAt: string;
  endAt: string;
  eventColor: string;
  source: string;
  manualOverride: boolean;
  needsReview: boolean;
  updatedAt: string;
}

interface EntertainmentScheduleResponse {
  from: string;
  to: string;
  timeZone: string;
  reservationCount: number;
  reservations: EntertainmentReservation[];
  fetchedAt: string;
}

const DEFAULT_URL = "https://eventhost-opal.vercel.app/api/entertainment-schedule";
const CACHE_MS = 60_000;
const STORAGE_BUCKET = "onpar-state";
const STORAGE_PATH = "entertainment-schedule/current.json";
let memoryCache: { value: EntertainmentScheduleResponse; expiresAt: number } | null = null;

function venueDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: readEnv("VENUE_TIME_ZONE") ?? "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentOperatingDayOnly(
  value: EntertainmentScheduleResponse | null,
): EntertainmentScheduleResponse | null {
  if (!value) return null;
  const today = venueDate();
  const reservations = value.reservations.filter(
    (reservation) => reservation.operatingDate === today,
  );
  return {
    ...value,
    from: today,
    to: today,
    reservationCount: reservations.length,
    reservations,
  };
}

async function readStored(): Promise<EntertainmentScheduleResponse | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH);
  if (error) return null;
  try {
    return JSON.parse(await data.text()) as EntertainmentScheduleResponse;
  } catch {
    return null;
  }
}

async function saveStored(value: EntertainmentScheduleResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
    STORAGE_PATH,
    JSON.stringify(value),
    { contentType: "application/json", upsert: true },
  );
  if (error) console.error("[entertainment schedule:storage]", error.message);
}

export async function getEntertainmentSchedule(): Promise<EntertainmentScheduleResponse | null> {
  if (memoryCache && Date.now() < memoryCache.expiresAt) {
    return currentOperatingDayOnly(memoryCache.value);
  }
  const stored = await readStored();
  const storedAt = stored ? new Date(stored.fetchedAt).getTime() : Number.NaN;
  if (stored && Number.isFinite(storedAt) && Date.now() - storedAt < CACHE_MS) {
    const current = currentOperatingDayOnly(stored);
    if (!current) return null;
    memoryCache = { value: current, expiresAt: Date.now() + CACHE_MS };
    return current;
  }

  const token = readEnv("ENTERTAINMENT_SCHEDULE_API_TOKEN");
  if (!token) return currentOperatingDayOnly(stored);
  const url = new URL(readEnv("ENTERTAINMENT_SCHEDULE_API_URL") ?? DEFAULT_URL);
  url.searchParams.set("from", venueDate());
  // Staff operations and wait calculations only need the current operating
  // day. Reservations crossing midnight remain included by operatingDate.
  url.searchParams.set("to", venueDate());
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload = (await response.json()) as Omit<EntertainmentScheduleResponse, "fetchedAt">;
    const value = currentOperatingDayOnly({
      ...payload,
      fetchedAt: new Date().toISOString(),
    });
    if (!value) return currentOperatingDayOnly(stored);
    await saveStored(value);
    memoryCache = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  } catch (error) {
    console.error("[entertainment schedule]", error);
    return currentOperatingDayOnly(stored);
  }
}

function canonicalResourceIds(activity: Activity, laneId: string): string[] {
  if (activity === "bowling") return [`bowling-${laneId}`];
  if (activity === "darts") return [`darts-${laneId}`, `dart-${laneId}`];
  if (activity === "shuffleboard") return [`shuffleboard-${laneId}`];
  const poolNumber = ({ red: "1", green: "2", blue: "3" } as Record<string, string>)[laneId] ?? laneId;
  return [`pool-${poolNumber}`, `pool-${laneId}`];
}

export function reservationsForActivity(
  activity: Activity,
  reservations: EntertainmentReservation[],
): EntertainmentReservation[] {
  const category = activity === "darts" ? ["darts", "dart"] : [activity];
  return reservations.filter((reservation) =>
    category.includes(reservation.resourceCategory.toLowerCase()),
  );
}

export function addScheduleWindows(
  activity: Activity,
  lanes: ResourceLaneAvailability[],
  reservations: EntertainmentReservation[],
  nowMs = Date.now(),
): ResourceLaneAvailability[] {
  return lanes.map((lane) => {
    const ids = canonicalResourceIds(activity, lane.id);
    const windows: ResourceUnavailableWindow[] = reservations
      // A manually entered Event Host row that still needs review is
      // informational, not confirmed capacity. Keep it visible in staff UI,
      // but do not create a false customer wait until it is reviewed.
      .filter(reservationBlocksAvailability)
      .filter((reservation) => ids.includes(reservation.resourceId.toLowerCase()))
      .map((reservation) => ({
        // Protect the resource for a full hour before the reservation so a
        // walk-in session cannot be placed where it would run into setup time.
        startAtSeconds: Math.max(
          0,
          Math.floor(
            (new Date(reservation.startAt).getTime() -
              RESERVATION_PROTECTION_MS -
              nowMs) /
              1000,
          ),
        ),
        endAtSeconds: Math.max(0, Math.ceil((new Date(reservation.endAt).getTime() - nowMs) / 1000)),
        reservationId: reservation.id,
        label: reservation.eventName,
        needsReview: reservation.needsReview,
      }))
      .filter((window) => window.endAtSeconds > 0)
      .sort((a, b) => a.startAtSeconds - b.startAtSeconds);
    const activeEnd = windows
      .filter((window) => window.startAtSeconds === 0)
      .reduce((max, window) => Math.max(max, window.endAtSeconds), 0);
    return {
      ...lane,
      availableAtSeconds: Math.max(lane.availableAtSeconds, activeEnd),
      unavailableWindows: windows,
    };
  });
}
