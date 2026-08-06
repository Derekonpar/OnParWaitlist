import { readEnv } from "./env";
import { getSupabaseAdmin } from "./supabase";
import type { ResourceLaneAvailability } from "./resource-scheduler";

export type DartseeLaneStatus = "open" | "occupied" | "unknown";
export type DartseeFeedHealth = "ok" | "partial" | "auth-error" | "connection-error" | "no-data";

export interface DartseeLaneReading {
  lane: number;
  boardId: string;
  name: string;
  status: DartseeLaneStatus;
  remainingSeconds: number;
  sessionId?: string;
  sessionEnd?: string;
  gameType?: string;
}

export interface DartseeLaneSnapshot {
  lanes: DartseeLaneReading[];
  capturedAt: string;
  receivedAt: string;
  source: string;
  healthStatus: DartseeFeedHealth;
  healthMessage?: string;
  healthUpdatedAt: string;
  knownLaneCount: number;
}

interface DartseeAuth {
  accessToken: string;
  expiresAt: number;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://central.dartsee.com";
const STORAGE_BUCKET = "onpar-state";
const STORAGE_PATH = "dartsee-lanes/current.json";
const DEFAULT_BOARD_IDS = [
  "beavercreek01",
  "beavercreek02",
  "beavercreek02b",
  "beavercreek03",
  "beavercreek05",
];
const HEARTBEAT = {
  command: "ping",
  clientType: "dashboard_global_admin",
  boardId: "dashboard_global_admin",
  version: "1.0.0",
  wifiSignal: "Unknown",
};

let authCache: DartseeAuth | null = null;
let snapshotCache:
  | { snapshot: DartseeLaneSnapshot | null; expiresAt: number }
  | null = null;
let snapshotRequest: Promise<DartseeLaneSnapshot | null> | null = null;

function envNumber(name: string, fallback: number): number {
  const value = Number(readEnv(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function baseUrl(): string {
  return (readEnv("DARTSEE_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function boardIds(): string[] {
  const configured = readEnv("DARTSEE_BOARD_IDS")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_BOARD_IDS;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 10000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`DARTSEE_HTTP_${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(): Promise<string | null> {
  const email = readEnv("DARTSEE_ADMIN_EMAIL");
  const password = readEnv("DARTSEE_ADMIN_PASSWORD");
  if (!email || !password) return null;

  if (authCache && Date.now() < authCache.expiresAt) {
    return authCache.accessToken;
  }

  const data = await fetchJson<{
    access_token?: string;
    expires?: number;
  }>(
    `${baseUrl()}/v2.0/auth/admin/login`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
    15000,
  );

  if (!data.access_token) return null;
  authCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60000, data.expires ?? 900000) - 60000,
  };
  return authCache.accessToken;
}

function parseDateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function laneFromBoardId(boardId: string, index: number): DartseeLaneReading {
  return {
    lane: index + 1,
    boardId,
    name: boardId,
    status: "unknown",
    remainingSeconds: 0,
  };
}

function setOpen(lane: DartseeLaneReading) {
  lane.status = "open";
  lane.remainingSeconds = 0;
  lane.sessionId = undefined;
  lane.sessionEnd = undefined;
  lane.gameType = undefined;
}

function setOccupied(
  lane: DartseeLaneReading,
  event: JsonRecord,
  nowMs: number,
) {
  const sessionEnd = event.sessionEnd;
  const endMs = parseDateMs(sessionEnd);
  if (!endMs) {
    lane.status = "unknown";
    lane.remainingSeconds = 0;
    return;
  }

  const remainingSeconds = Math.max(0, Math.ceil((endMs - nowMs) / 1000));
  if (remainingSeconds <= 0) {
    setOpen(lane);
    return;
  }

  lane.status = "occupied";
  lane.remainingSeconds = remainingSeconds;
  lane.sessionId =
    typeof event.sessionId === "string" ? event.sessionId : lane.sessionId;
  lane.sessionEnd = typeof sessionEnd === "string" ? sessionEnd : undefined;
  lane.gameType = isRecord(event.game) && typeof event.game.gameType === "string"
    ? event.game.gameType
    : lane.gameType;
}

function eventBoardIds(fallbackBoardId: string, event: JsonRecord): string[] {
  if (Array.isArray(event.boardIds)) {
    const ids = event.boardIds.filter((item): item is string => {
      return typeof item === "string" && item.length > 0;
    });
    if (ids.length) return ids;
  }
  return [fallbackBoardId];
}

function applyDartseeEvent(
  lanesByBoard: Map<string, DartseeLaneReading>,
  boardId: string,
  event: JsonRecord,
  nowMs: number,
) {
  const command = event.command;
  if (typeof command !== "string") return;

  const targetBoardIds = eventBoardIds(boardId, event);
  for (const targetBoardId of targetBoardIds) {
    const lane = lanesByBoard.get(targetBoardId);
    if (!lane) continue;

    if (command === "isAlive" && event.isAlive === false) {
      lane.status = "unknown";
      lane.remainingSeconds = 0;
      continue;
    }

    if (command === "ping") {
      if (event.hasSession === false) setOpen(lane);
      continue;
    }

    if (command === "close_session") {
      setOpen(lane);
      continue;
    }

    if (command === "new_session") {
      setOccupied(lane, event, nowMs);
      continue;
    }

    if (command === "refresh_game") {
      const gameType = isRecord(event.game) && typeof event.game.gameType === "string"
        ? event.game.gameType
        : undefined;
      if (gameType === "NO_GAME") setOpen(lane);
      else lane.gameType = gameType ?? lane.gameType;
    }
  }
}

function applyDartseePayload(
  lanesByBoard: Map<string, DartseeLaneReading>,
  payload: unknown,
  nowMs: number,
) {
  if (!isRecord(payload)) return;

  if (typeof payload.command === "string") {
    const boardId =
      typeof payload.boardId === "string" ? payload.boardId : "global";
    applyDartseeEvent(lanesByBoard, boardId, payload, nowMs);
    return;
  }

  for (const [boardId, value] of Object.entries(payload)) {
    const events = Array.isArray(value) ? value : [value];
    for (const event of events) {
      if (isRecord(event)) applyDartseeEvent(lanesByBoard, boardId, event, nowMs);
    }
  }
}

function closeSocket(ws: WebSocket) {
  try {
    ws.close();
  } catch {
    // The socket may already be closed by the runtime.
  }
}

async function readLiveSnapshot(
  ids: string[],
  token: string,
): Promise<DartseeLaneSnapshot | null> {
  if (typeof WebSocket === "undefined") return null;

  const timeoutMs = envNumber("DARTSEE_WS_TIMEOUT_MS", 8000);
  const now = new Date();
  const lanesByBoard = new Map(
    ids.map((id, index) => [id, laneFromBoardId(id, index)] as const),
  );
  const venueId = readEnv("DARTSEE_VENUE_ID");
  if (!venueId) return null;
  const url = `${baseUrl().replace(/^http/, "ws")}/ws/dashboard?boardIds=${ids.join(
    ",",
  )}&venueId=${encodeURIComponent(venueId)}&token=${encodeURIComponent(token)}`;

  return new Promise((resolve) => {
    let done = false;
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let connected = false;
    let socketFailed = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (pingTimer) clearTimeout(pingTimer);
      clearTimeout(timeout);
      if (ws) closeSocket(ws);
      const lanes = Array.from(lanesByBoard.values());
      const knownLaneCount = lanes.filter((lane) => lane.status !== "unknown").length;
      const healthStatus: DartseeFeedHealth = socketFailed
        ? "connection-error"
        : knownLaneCount === ids.length
          ? "ok"
          : knownLaneCount > 0
            ? "partial"
            : connected
              ? "no-data"
              : "connection-error";
      const healthMessage = healthStatus === "ok"
        ? undefined
        : healthStatus === "partial"
          ? `Dartsee answered for ${knownLaneCount} of ${ids.length} lanes. Check the Dartsee unit for any lane showing --.`
          : healthStatus === "no-data"
            ? "Dartsee connected but returned no lane status. Wait a few seconds, then check the Dartsee Central dashboard."
            : "Dartsee did not accept or maintain the live dashboard connection. Check internet access and the Dartsee Central service.";
      const receivedAt = new Date().toISOString();
      resolve({
        lanes,
        capturedAt: now.toISOString(),
        receivedAt,
        source: "dartsee-dashboard-ws",
        healthStatus,
        healthMessage,
        healthUpdatedAt: receivedAt,
        knownLaneCount,
      });
    };

    const timeout = setTimeout(finish, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("[dartsee lanes:ws-create]", err);
      clearTimeout(timeout);
      resolve(null);
      return;
    }
    const socket = ws;

    const sendPing = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(HEARTBEAT));
    };

    socket.addEventListener("open", () => {
      connected = true;
      sendPing();
      pingTimer = setTimeout(sendPing, 1000);
    });

    socket.addEventListener("message", (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        applyDartseePayload(lanesByBoard, JSON.parse(raw), Date.now());
      } catch (err) {
        console.error("[dartsee lanes:ws-parse]", err);
      }
    });

    socket.addEventListener("error", () => {
      socketFailed = true;
      finish();
    });

    socket.addEventListener("close", () => {
      finish();
    });
  });
}

async function getStoredSnapshot(): Promise<DartseeLaneSnapshot | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH);
  if (error) return null;
  try {
    return JSON.parse(await data.text()) as DartseeLaneSnapshot;
  } catch {
    return null;
  }
}

async function saveStoredSnapshot(snapshot: DartseeLaneSnapshot) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
    STORAGE_PATH,
    JSON.stringify(snapshot),
    { contentType: "application/json", upsert: true },
  );
  if (error) console.error("[dartsee lanes:storage-write]", error.message);
}

function mergeLastKnown(
  current: DartseeLaneSnapshot,
  previous: DartseeLaneSnapshot | null,
): DartseeLaneSnapshot {
  if (!previous || current.healthStatus === "ok") return current;
  const previousByBoard = new Map(previous.lanes.map((lane) => [lane.boardId, lane]));
  const previousAgeSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(previous.capturedAt).getTime()) / 1000),
  );
  return {
    ...current,
    lanes: current.lanes.map((lane) => {
      if (lane.status !== "unknown") return lane;
      const retained = previousByBoard.get(lane.boardId);
      if (!retained) return lane;
      if (retained.status !== "occupied") return retained;
      const remainingSeconds = Math.max(0, retained.remainingSeconds - previousAgeSeconds);
      return remainingSeconds > 0
        ? { ...retained, remainingSeconds }
        : { ...retained, status: "open", remainingSeconds: 0 };
    }),
    healthMessage: `${current.healthMessage ?? "Dartsee feed needs attention"} Last known status is retained for unreadable lanes.`,
  };
}

export async function getDartseeLaneSnapshot(): Promise<DartseeLaneSnapshot | null> {
  const cacheMs = envNumber("DARTSEE_CACHE_MS", 15000);
  if (snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.snapshot;
  }

  if (snapshotRequest) return snapshotRequest;

  snapshotRequest = (async () => {
    try {
      const token = await getAccessToken();
      if (!token) return null;
      const liveSnapshot = await readLiveSnapshot(boardIds(), token);
      if (!liveSnapshot) return null;
      const previous = await getStoredSnapshot();
      const snapshot = mergeLastKnown(liveSnapshot, previous);
      await saveStoredSnapshot(snapshot);
      snapshotCache = { snapshot, expiresAt: Date.now() + cacheMs };
      return snapshot;
    } catch (err) {
      console.error("[dartsee lanes]", err);
      authCache = null;
      const previous = await getStoredSnapshot();
      if (!previous) {
        snapshotCache = { snapshot: null, expiresAt: Date.now() + cacheMs };
        return null;
      }
      const now = new Date().toISOString();
      const snapshot: DartseeLaneSnapshot = {
        ...previous,
        receivedAt: now,
        healthStatus: "auth-error",
        healthMessage: "Dartsee login or API access failed. Last known lane status is shown. Verify the Dartsee account and Central service.",
        healthUpdatedAt: now,
      };
      snapshotCache = { snapshot, expiresAt: Date.now() + cacheMs };
      return snapshot;
    } finally {
      snapshotRequest = null;
    }
  })();

  return snapshotRequest;
}

export function dartseeSnapshotToAvailability(
  snapshot: DartseeLaneSnapshot | null,
  nowMs = Date.now(),
): ResourceLaneAvailability[] | undefined {
  if (!snapshot) return undefined;
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  const elapsedSeconds = Number.isFinite(capturedAt)
    ? Math.max(0, Math.floor((nowMs - capturedAt) / 1000))
    : 0;

  return snapshot.lanes.map((lane) => ({
    id: lane.boardId,
    label: `Dart ${lane.lane}`,
    availableAtSeconds:
      lane.status === "open"
        ? 0
        : lane.status === "occupied"
          ? Math.max(0, lane.remainingSeconds - elapsedSeconds)
          : Number.POSITIVE_INFINITY,
  }));
}
