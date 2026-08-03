import { getSupabaseAdmin } from "./supabase";

export type BowlingLaneStatus = "open" | "occupied" | "unknown";

export interface BowlingLaneReading {
  lane: number;
  status: BowlingLaneStatus;
  remainingSeconds: number;
  rawText?: string;
  confidence?: number;
}

export interface BowlingLaneSnapshot {
  lanes: BowlingLaneReading[];
  capturedAt: string;
  receivedAt: string;
  source: string;
}

const SNAPSHOT_ID = "current";
const LANE_COUNT = 12;
const STORAGE_BUCKET = "onpar-state";
const STORAGE_PATH = "bowling-lanes/current.json";

function isMissingTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST205" ||
    error.message?.includes("Could not find the table")
  );
}

function normalizeLane(reading: BowlingLaneReading): BowlingLaneReading {
  const status = reading.status ?? "unknown";
  return {
    lane: reading.lane,
    status,
    remainingSeconds:
      status === "occupied"
        ? Math.max(0, Math.round(reading.remainingSeconds ?? 0))
        : 0,
    rawText: reading.rawText,
    confidence: reading.confidence,
  };
}

export function normalizeBowlingLaneSnapshot(input: {
  lanes: BowlingLaneReading[];
  capturedAt?: string;
  source?: string;
}): BowlingLaneSnapshot {
  const byLane = new Map<number, BowlingLaneReading>();
  for (const lane of input.lanes) {
    if (lane.lane < 1 || lane.lane > LANE_COUNT) continue;
    byLane.set(lane.lane, normalizeLane(lane));
  }

  const lanes = Array.from({ length: LANE_COUNT }, (_, i) => {
    const laneNumber = i + 1;
    return (
      byLane.get(laneNumber) ?? {
        lane: laneNumber,
        status: "unknown" as const,
        remainingSeconds: 0,
      }
    );
  });

  const now = new Date().toISOString();
  return {
    lanes,
    capturedAt: input.capturedAt ?? now,
    receivedAt: now,
    source: input.source ?? "brunswick-ocr",
  };
}

function rowToSnapshot(row: Record<string, unknown>): BowlingLaneSnapshot {
  return {
    lanes: normalizeBowlingLaneSnapshot({
      lanes: Array.isArray(row.lanes)
        ? (row.lanes as BowlingLaneReading[])
        : [],
      capturedAt: String(row.captured_at ?? row.capturedAt ?? new Date().toISOString()),
      source: String(row.source ?? "brunswick-ocr"),
    }).lanes,
    capturedAt: String(row.captured_at ?? row.capturedAt ?? new Date().toISOString()),
    receivedAt: String(row.updated_at ?? row.updatedAt ?? new Date().toISOString()),
    source: String(row.source ?? "brunswick-ocr"),
  };
}

async function getStorageSnapshot(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
): Promise<BowlingLaneSnapshot | null> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(STORAGE_PATH);

  if (error) {
    if ("statusCode" in error && String(error.statusCode) === "404") {
      return null;
    }
    console.error("[bowling lanes:storage-read]", error.message);
    return null;
  }

  try {
    const raw = await data.text();
    const parsed = JSON.parse(raw) as BowlingLaneSnapshot;
    return normalizeBowlingLaneSnapshot(parsed);
  } catch (err) {
    console.error("[bowling lanes:storage-parse]", err);
    return null;
  }
}

async function ensureStorageBucket(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
) {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets();
  if (listError) {
    console.error("[bowling lanes:storage-buckets]", listError.message);
    throw listError;
  }

  if (buckets?.some((bucket) => bucket.name === STORAGE_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
    public: false,
  });
  if (error && !error.message.includes("already exists")) {
    console.error("[bowling lanes:storage-create]", error.message);
    throw error;
  }
}

async function saveStorageSnapshot(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  snapshot: BowlingLaneSnapshot,
): Promise<BowlingLaneSnapshot> {
  await ensureStorageBucket(supabase);

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_PATH, JSON.stringify(snapshot), {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    console.error("[bowling lanes:storage-write]", error.message);
    throw error;
  }

  return snapshot;
}

export async function getBowlingLaneSnapshot(): Promise<BowlingLaneSnapshot | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("bowling_lane_state")
    .select("*")
    .eq("id", SNAPSHOT_ID)
    .maybeSingle();

  if (error) {
    console.error("[bowling lanes:read]", error.message, error.code);
    if (isMissingTableError(error)) {
      return getStorageSnapshot(supabase);
    }
    return null;
  }
  return data ? rowToSnapshot(data as Record<string, unknown>) : null;
}

export async function saveBowlingLaneSnapshot(
  input: BowlingLaneSnapshot,
): Promise<BowlingLaneSnapshot> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("STORAGE_NOT_CONFIGURED");

  const snapshot = normalizeBowlingLaneSnapshot(input);
  const { data, error } = await supabase
    .from("bowling_lane_state")
    .upsert({
      id: SNAPSHOT_ID,
      lanes: snapshot.lanes,
      source: snapshot.source,
      captured_at: snapshot.capturedAt,
      updated_at: snapshot.receivedAt,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[bowling lanes:write]", error.message, error.code);
    if (isMissingTableError(error)) {
      return saveStorageSnapshot(supabase, snapshot);
    }
    throw error;
  }

  return rowToSnapshot(data as Record<string, unknown>);
}
