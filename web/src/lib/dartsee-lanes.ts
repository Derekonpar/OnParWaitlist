import { readEnv } from "./env";
import { getSupabaseAdmin } from "./supabase";
import type { ResourceLaneAvailability } from "./resource-scheduler";
import { getStoredEntertainmentSchedule } from "./entertainment-schedule";
import { reservationConflictsWithSession } from "./reservation-policy";
import { withDeadline } from "./async-deadline";
import { inspectDartseeEndSession } from "./dartsee-session-safety";
import {
  compareDartseeSnapshotVersions,
  dartseeSnapshotStorageObjectName,
} from "./dartsee-snapshot-order";
import {
  mergeDartseeControlGuards,
  snapshotWithConfirmedDartseeControl,
  type DartseeControlGuard,
} from "./dartsee-control-guard";
import {
  DARTSEE_START_DURATIONS,
  dartseeCommandDurationMinutes,
  isDartseeOverrideDuration,
  type DartseeStartDuration,
} from "./dartsee-duration";
import {
  dartseeExtensionConfirmationMatches,
  inspectDartseeOverrideLane,
  isDefinitiveDartseeOverrideRejection,
} from "./dartsee-override-safety";
import {
  DEFAULT_DARTSEE_BOARD_IDS,
  normalizeDartseeBoardIds,
  normalizeDartseeLaneIdentities,
} from "./dartsee-board-map";

export {
  DARTSEE_START_BUFFER_MINUTES,
  DARTSEE_START_DURATIONS,
  dartseeCommandDurationMinutes,
  type DartseeStartDuration,
} from "./dartsee-duration";

export type DartseeLaneStatus = "open" | "occupied" | "unknown";
export type DartseeFeedHealth = "ok" | "partial" | "auth-error" | "connection-error" | "no-data";

export interface DartseeLaneReading {
  lane: number;
  boardId: string;
  name: string;
  status: DartseeLaneStatus;
  remainingSeconds: number;
  /** Lower bound for when this exact board state was observed live. */
  observedAt?: string;
  sessionId?: string;
  sessionEnd?: string;
  maxPlayers?: number;
  gameType?: string;
  /** Short-lived proof that a Start or End was confirmed by the live socket. */
  controlGuard?: DartseeControlGuard;
}

export interface DartseeLaneSnapshot {
  lanes: DartseeLaneReading[];
  capturedAt: string;
  /** Logical lower bound for ordering lane-state publications across isolates. */
  stateVersionAt?: string;
  receivedAt: string;
  source: string;
  healthStatus: DartseeFeedHealth;
  healthMessage?: string;
  healthUpdatedAt: string;
  knownLaneCount: number;
  consecutiveIncompleteRefreshes?: number;
  unresponsiveBoardIds?: string[];
}

export type DartseeLaneStartFailureCode =
  | "invalid-configuration"
  | "already-in-progress"
  | "schedule-unavailable"
  | "reservation-conflict"
  | "feed-unavailable"
  | "lane-occupied"
  | "control-unavailable"
  | "control-rejected";

export type DartseeLaneStartResult =
  | {
      ok: true;
      confirmed: boolean;
      checkedAt: string;
      lane: DartseeLaneReading | null;
      snapshot: DartseeLaneSnapshot | null;
    }
  | {
      ok: false;
      code: DartseeLaneStartFailureCode;
      conflict?: {
        eventName: string;
        startAt: string;
      };
    };

export type DartseeLaneEndFailureCode =
  | "invalid-configuration"
  | "already-in-progress"
  | "feed-unavailable"
  | "lane-open"
  | "session-unavailable"
  | "shared-session"
  | "control-unavailable"
  | "control-rejected";

export type DartseeLaneEndResult =
  | {
      ok: true;
      confirmed: boolean;
      checkedAt: string;
      lane: DartseeLaneReading | null;
      snapshot: DartseeLaneSnapshot | null;
    }
  | {
      ok: false;
      code: DartseeLaneEndFailureCode;
    };

export type DartseeLaneOverrideAction = "start" | "extend";

export type DartseeLaneOverrideFailureCode =
  | "invalid-configuration"
  | "already-in-progress"
  | "schedule-unavailable"
  | "feed-unavailable"
  | "session-unavailable"
  | "shared-session"
  | "lane-state-changed"
  | "control-unavailable"
  | "control-rejected";

export type DartseeLaneOverrideResult =
  | {
      ok: true;
      action: DartseeLaneOverrideAction;
      confirmed: boolean;
      checkedAt: string;
      lane: DartseeLaneReading | null;
      snapshot: DartseeLaneSnapshot | null;
      expectedSessionId?: string;
      expectedSessionEnd?: string;
    }
  | {
      ok: false;
      code: DartseeLaneOverrideFailureCode;
    };

interface DartseeAuth {
  accessToken: string;
  expiresAt: number;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://central.dartsee.com";
const STORAGE_BUCKET = "onpar-state";
const STORAGE_PATH = "dartsee-lanes/current.json";
const STORAGE_SNAPSHOT_PREFIX = "dartsee-lanes/snapshots";
// Immutable snapshots must not share a rollout lease with the legacy
// `current.json` publisher. A legacy winner cannot publish where a new reader
// looks (and vice versa), so sharing the lease would suppress useful refreshes
// during a mixed-version deployment.
const STORAGE_LOCK_PREFIX = "dartsee-lanes/refresh-lock-v2";
const START_LOCK_PREFIX = "dartsee-lanes/start-lock";
const REFRESH_LEASE_WINDOW_MS = 15_000;
// Staff and TV pages poll every 15 seconds. Refresh slightly ahead of that
// cadence while the durable 15-second lease remains the global fanout cap.
const REFRESH_TARGET_AGE_MS = 10_000;
const START_LEASE_WINDOW_MS = 10_000;
const START_STORAGE_DEADLINE_MS = 1_500;
const START_SCHEDULE_READ_DEADLINE_MS = 1_800;
const START_POST_TIMEOUT_MS = 5_000;
const CONTROL_CONFIRM_TIMEOUT_MS = 4_000;
const START_SCHEDULE_MAX_AGE_MS = 2 * 60_000;
const START_CONFIRM_END_TOLERANCE_MS = 3 * 60_000;
const PUBLISH_STORAGE_DEADLINE_MS = 1_000;
const STORED_SNAPSHOT_LIST_LIMIT = 30;
const STORED_SNAPSHOT_RETAIN_COUNT = 12;
const STORED_SNAPSHOT_READ_CACHE_MS = 5_000;
const REFRESH_IN_FLIGHT_GUARD_MS = 30_000;
const LEASE_LOSER_RETRY_MS = 3_000;
const REFRESH_ERROR_RETRY_MS = 15_000;
const HEARTBEAT = {
  command: "ping",
  clientType: "dashboard_global_admin",
  boardId: "dashboard_global_admin",
  version: "1.0.0",
  wifiSignal: "Unknown",
};

interface DartseeControlTiming {
  startedAtMs: number;
  parallelReadyAtMs?: number;
  postStartedAtMs?: number;
  postFinishedAtMs?: number;
  postResult?:
    | "response-2xx"
    | "response-3xx"
    | "response-4xx"
    | "response-5xx"
    | "request-failed";
  confirmationFinishedAtMs?: number;
  outcome:
    | "confirmed"
    | "unconfirmed"
    | DartseeLaneStartFailureCode
    | DartseeLaneEndFailureCode
    | DartseeLaneOverrideFailureCode;
}

function logDartseeControlTiming(
  action: "start" | "end" | "override",
  timing: DartseeControlTiming,
) {
  const finishedAtMs = Date.now();
  const parallelReadyAtMs = timing.parallelReadyAtMs;
  const postStartedAtMs = timing.postStartedAtMs;
  const postFinishedAtMs = timing.postFinishedAtMs;
  const confirmationFinishedAtMs = timing.confirmationFinishedAtMs;
  console.info("[dartsee control:timing]", {
    action,
    outcome: timing.outcome,
    parallelPrepareMs: parallelReadyAtMs === undefined
      ? null
      : Math.max(0, parallelReadyAtMs - timing.startedAtMs),
    safetyCheckMs:
      parallelReadyAtMs === undefined || postStartedAtMs === undefined
        ? null
        : Math.max(0, postStartedAtMs - parallelReadyAtMs),
    postMs:
      postStartedAtMs === undefined || postFinishedAtMs === undefined
        ? null
        : Math.max(0, postFinishedAtMs - postStartedAtMs),
    postResult: timing.postResult ?? null,
    confirmationMs:
      postFinishedAtMs === undefined || confirmationFinishedAtMs === undefined
        ? null
        : Math.max(0, confirmationFinishedAtMs - postFinishedAtMs),
    totalMs: Math.max(0, finishedAtMs - timing.startedAtMs),
  });
}

let authCache: DartseeAuth | null = null;
let snapshotCache:
  | { snapshot: DartseeLaneSnapshot | null; expiresAt: number }
  | null = null;
// Cloudflare may reuse a module across otherwise isolated requests. Never put
// request-bound promises here: an in-flight fetch/WebSocket promise cannot be
// safely awaited by a different request. These timestamps are only best-effort
// in-isolate throttles; the durable storage lease coordinates across isolates.
let nextRefreshAttemptAt = 0;
let nextStoredReadAt = 0;
const localStartGuards = new Map<number, number>();

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
  return normalizeDartseeBoardIds(
    configured?.length ? configured : DEFAULT_DARTSEE_BOARD_IDS,
  );
}

export function dartseeBoardIdForLane(lane: number): string | null {
  if (!Number.isInteger(lane) || lane < 1 || lane > 5) return null;
  const ids = boardIds();
  if (ids.length !== 5 || new Set(ids).size !== 5) return null;
  return ids[lane - 1] ?? null;
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

function isDartseeAuthorizationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "DARTSEE_HTTP_401" ||
      error.message === "DARTSEE_HTTP_403")
  );
}

async function getAccessToken(timeoutMs = 15_000): Promise<string | null> {
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
    timeoutMs,
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

function parseVenueDateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(" ", "T");
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    return parseDateMs(normalized);
  }
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const timeZone = readEnv("VENUE_TIME_ZONE") ?? "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(wallClockUtc));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedUtc = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second),
  );
  return wallClockUtc - (representedUtc - wallClockUtc);
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
  lane.maxPlayers = undefined;
  lane.gameType = undefined;
}

function setOccupied(
  lane: DartseeLaneReading,
  event: JsonRecord,
  nowMs: number,
) {
  const sessionEnd = event.sessionEnd;
  const endMs = parseVenueDateMs(sessionEnd);
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
  lane.sessionEnd = new Date(endMs).toISOString();
  const maxPlayers = event.maxPlayers;
  lane.maxPlayers =
    typeof maxPlayers === "number" &&
    Number.isInteger(maxPlayers) &&
    maxPlayers >= 1
      ? maxPlayers
      : lane.maxPlayers;
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
      lane.gameType = gameType ?? lane.gameType;
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
  timeoutOverrideMs?: number,
): Promise<DartseeLaneSnapshot | null> {
  if (typeof WebSocket === "undefined") return null;

  const timeoutMs = timeoutOverrideMs ?? envNumber("DARTSEE_WS_TIMEOUT_MS", 8000);
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
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let connected = false;
    let socketFailed = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (pingTimer) clearTimeout(pingTimer);
      if (settleTimer) clearTimeout(settleTimer);
      clearTimeout(timeout);
      if (ws) closeSocket(ws);
      const stateVersionAt = now.toISOString();
      const lanes = Array.from(lanesByBoard.values()).map((lane) =>
        lane.status === "unknown"
          ? lane
          : { ...lane, observedAt: stateVersionAt },
      );
      const knownLaneCount = lanes.filter((lane) => lane.status !== "unknown").length;
      const unresponsiveBoardIds = lanes
        .filter((lane) => lane.status === "unknown")
        .map((lane) => lane.boardId);
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
        capturedAt: stateVersionAt,
        stateVersionAt,
        receivedAt,
        source: "dartsee-dashboard-ws",
        healthStatus,
        healthMessage,
        healthUpdatedAt: receivedAt,
        knownLaneCount,
        unresponsiveBoardIds,
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
        if (
          !settleTimer &&
          Array.from(lanesByBoard.values()).every(
            (lane) => lane.status !== "unknown",
          )
        ) {
          // Allow closely-following game metadata to arrive, then release the
          // socket instead of holding every refresh open for the full timeout.
          settleTimer = setTimeout(finish, 250);
        }
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

type DartseeLanePredicate = (lane: DartseeLaneReading) => boolean;

interface DartseeControlObserver {
  lanes(): DartseeLaneReading[];
  isActive(): boolean;
  waitForLane(
    boardId: string,
    observedNotBeforeMs: number,
    predicate: DartseeLanePredicate,
    timeoutMs?: number,
  ): Promise<DartseeLaneReading | null>;
  close(): void;
}

interface DartseeLaneWaiter {
  boardId: string;
  observedNotBeforeMs: number;
  predicate: DartseeLanePredicate;
  resolve: (lane: DartseeLaneReading | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

function laneStateSignature(lane: DartseeLaneReading): string {
  return [
    lane.status,
    lane.sessionId ?? "",
    lane.sessionEnd ?? "",
    lane.maxPlayers ?? "",
  ].join(":");
}

/**
 * Open one short-lived dashboard socket that remains connected across a
 * control preflight and its exactly-once POST. Dartsee's own state event can
 * then confirm the command immediately, without a fixed sleep or a second
 * WebSocket handshake.
 */
async function openDartseeControlObserver(
  ids: string[],
  token: string,
  preflightTimeoutMs: number,
): Promise<DartseeControlObserver | null> {
  if (typeof WebSocket === "undefined") return null;
  const venueId = readEnv("DARTSEE_VENUE_ID");
  if (!venueId) return null;

  const lanesByBoard = new Map(
    ids.map((id, index) => [id, laneFromBoardId(id, index)] as const),
  );
  const observedAtByBoard = new Map<string, number>();
  const waiters = new Set<DartseeLaneWaiter>();
  const url = `${baseUrl().replace(/^http/, "ws")}/ws/dashboard?boardIds=${ids.join(
    ",",
  )}&venueId=${encodeURIComponent(venueId)}&token=${encodeURIComponent(token)}`;

  return new Promise((resolve) => {
    let readySettled = false;
    let closed = false;
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    const currentLanes = () =>
      Array.from(lanesByBoard.values()).map((lane) => ({ ...lane }));

    const finishWaiter = (
      waiter: DartseeLaneWaiter,
      lane: DartseeLaneReading | null,
    ) => {
      if (!waiters.delete(waiter)) return;
      clearTimeout(waiter.timer);
      waiter.resolve(lane ? { ...lane } : null);
    };

    const notifyWaiters = () => {
      for (const waiter of [...waiters]) {
        const lane = lanesByBoard.get(waiter.boardId);
        const observedAtMs = observedAtByBoard.get(waiter.boardId) ?? 0;
        if (
          lane &&
          observedAtMs >= waiter.observedNotBeforeMs &&
          waiter.predicate(lane)
        ) {
          finishWaiter(waiter, lane);
        }
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(preflightTimer);
      if (pingTimer) clearTimeout(pingTimer);
      for (const waiter of [...waiters]) finishWaiter(waiter, null);
      if (ws) closeSocket(ws);
      if (!readySettled) {
        readySettled = true;
        resolve(null);
      }
    };

    const observer: DartseeControlObserver = {
      lanes: currentLanes,
      isActive: () =>
        !closed && ws !== null && ws.readyState === WebSocket.OPEN,
      waitForLane(
        boardId,
        observedNotBeforeMs,
        predicate,
        timeoutMs = CONTROL_CONFIRM_TIMEOUT_MS,
      ) {
        if (closed) return Promise.resolve(null);
        const current = lanesByBoard.get(boardId);
        const observedAtMs = observedAtByBoard.get(boardId) ?? 0;
        if (
          current &&
          observedAtMs >= observedNotBeforeMs &&
          predicate(current)
        ) {
          return Promise.resolve({ ...current });
        }
        return new Promise((waiterResolve) => {
          const waiter: DartseeLaneWaiter = {
            boardId,
            observedNotBeforeMs,
            predicate,
            resolve: waiterResolve,
            timer: setTimeout(() => finishWaiter(waiter, null), timeoutMs),
          };
          waiters.add(waiter);
          // Recheck after registration so an event at this boundary cannot be
          // missed between the initial inspection and adding the waiter.
          notifyWaiters();
        });
      },
      close,
    };

    const preflightTimer = setTimeout(close, preflightTimeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      close();
      return;
    }
    const socket = ws;

    const sendPing = () => {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(HEARTBEAT));
      pingTimer = setTimeout(sendPing, 1_000);
    };

    socket.addEventListener("open", sendPing);
    socket.addEventListener("message", (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        const before = new Map(
          currentLanes().map((lane) => [lane.boardId, laneStateSignature(lane)]),
        );
        const observedAtMs = Date.now();
        applyDartseePayload(lanesByBoard, JSON.parse(raw), observedAtMs);
        const observedAt = new Date(observedAtMs).toISOString();
        for (const lane of lanesByBoard.values()) {
          if (before.get(lane.boardId) !== laneStateSignature(lane)) {
            lane.observedAt = observedAt;
            observedAtByBoard.set(lane.boardId, observedAtMs);
          }
        }
        notifyWaiters();
        if (
          !readySettled &&
          Array.from(lanesByBoard.values()).every(
            (lane) => lane.status !== "unknown",
          )
        ) {
          readySettled = true;
          clearTimeout(preflightTimer);
          resolve(observer);
        }
      } catch {
        // Ignore malformed dashboard frames and keep waiting for valid state.
      }
    });
    socket.addEventListener("error", close);
    socket.addEventListener("close", close);
  });
}

async function retryMissingBoards(
  snapshot: DartseeLaneSnapshot,
  token: string,
): Promise<DartseeLaneSnapshot> {
  if (snapshot.healthStatus !== "partial") return snapshot;
  const missingIds = snapshot.lanes
    .filter((lane) => lane.status === "unknown")
    .map((lane) => lane.boardId);
  if (!missingIds.length) return snapshot;

  // A busy Dartsee dashboard frequently omits one board from the venue-wide
  // response. Retry only those boards so one late unit does not poison the
  // entire five-lane snapshot or double the normal connection load.
  const retry = await readLiveSnapshot(missingIds, token, 4_000);
  if (!retry) return snapshot;
  const retryByBoard = new Map(retry.lanes.map((lane) => [lane.boardId, lane]));
  const lanes = snapshot.lanes.map((lane) => {
    const recovered = retryByBoard.get(lane.boardId);
    return recovered && recovered.status !== "unknown"
      ? { ...recovered, lane: lane.lane, name: lane.name }
      : lane;
  });
  const knownLaneCount = lanes.filter((lane) => lane.status !== "unknown").length;
  if (knownLaneCount === snapshot.lanes.length) {
    return {
      ...snapshot,
      lanes,
      receivedAt: retry.receivedAt,
      healthStatus: "ok",
      healthMessage: undefined,
      healthUpdatedAt: retry.receivedAt,
      knownLaneCount,
      consecutiveIncompleteRefreshes: 0,
      unresponsiveBoardIds: [],
    };
  }
  return {
    ...snapshot,
    lanes,
    knownLaneCount,
    unresponsiveBoardIds: lanes
      .filter((lane) => lane.status === "unknown")
      .map((lane) => lane.boardId),
  };
}

function rememberSnapshot(
  snapshot: DartseeLaneSnapshot | null,
  cacheMs: number,
) {
  snapshotCache = {
    snapshot,
    expiresAt: Date.now() + cacheMs,
  };
}

function snapshotAgeMs(
  snapshot: DartseeLaneSnapshot | null,
  nowMs = Date.now(),
): number {
  if (!snapshot) return Number.POSITIVE_INFINITY;
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  return Number.isFinite(capturedAt)
    ? Math.max(0, nowMs - capturedAt)
    : Number.POSITIVE_INFINITY;
}

function refreshTargetAgeMs(cacheMs: number): number {
  return Math.min(cacheMs, REFRESH_TARGET_AGE_MS);
}

function nextSnapshotRefreshAt(
  snapshot: DartseeLaneSnapshot | null,
  targetAgeMs: number,
  requestStartedAt: number,
): number {
  if (!snapshot) return requestStartedAt;
  const capturedAt = new Date(snapshot.capturedAt).getTime();
  return Number.isFinite(capturedAt)
    ? Math.max(requestStartedAt, capturedAt + targetAgeMs)
    : requestStartedAt;
}

async function getStoredSnapshot(): Promise<DartseeLaneSnapshot | null> {
  const now = Date.now();
  if (snapshotCache && now < snapshotCache.expiresAt) {
    return snapshotCache.snapshot;
  }
  const lastKnown = snapshotCache?.snapshot ?? null;
  if (now < nextStoredReadAt) return lastKnown;
  // Claim the read window before downloading so concurrent public polls do not
  // fan out into identical storage reads. They safely receive last-known data.
  nextStoredReadAt = now + STORED_SNAPSHOT_READ_CACHE_MS;
  let snapshot: DartseeLaneSnapshot | null = null;
  try {
    snapshot = await downloadStoredSnapshotUncached();
  } catch {
    rememberSnapshot(lastKnown, STORED_SNAPSHOT_READ_CACHE_MS);
    return lastKnown;
  }
  if (!snapshot) {
    rememberSnapshot(lastKnown, STORED_SNAPSHOT_READ_CACHE_MS);
    return lastKnown;
  }
  try {
    // Older isolates may have persisted a partial flag before the sustained
    // failure threshold was introduced. Apply the same tolerance when reading
    // shared cache so staff do not wait for this isolate to win a refresh lease.
    if (
      snapshot.healthStatus === "partial" &&
      (snapshot.consecutiveIncompleteRefreshes ?? 0) < 20
    ) {
      const tolerated = {
        ...snapshot,
        healthStatus: "ok" as const,
        healthMessage: undefined,
      };
      rememberSnapshot(tolerated, STORED_SNAPSHOT_READ_CACHE_MS);
      return tolerated;
    }
    rememberSnapshot(snapshot, STORED_SNAPSHOT_READ_CACHE_MS);
    return snapshot;
  } catch {
    rememberSnapshot(lastKnown, STORED_SNAPSHOT_READ_CACHE_MS);
    return lastKnown;
  }
}

/** Read the shared last-known-good snapshot without polling Dartsee. */
export async function getStoredDartseeLaneSnapshot(): Promise<DartseeLaneSnapshot | null> {
  return getStoredSnapshot();
}

function isStoredSnapshot(value: unknown): value is DartseeLaneSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.lanes) &&
    typeof value.capturedAt === "string" &&
    typeof value.receivedAt === "string" &&
    typeof value.source === "string" &&
    typeof value.healthStatus === "string" &&
    typeof value.healthUpdatedAt === "string" &&
    typeof value.knownLaneCount === "number"
  );
}

function snapshotStoragePath(snapshot: DartseeLaneSnapshot): string {
  return `${STORAGE_SNAPSHOT_PREFIX}/${dartseeSnapshotStorageObjectName(
    snapshot,
    crypto.randomUUID(),
  )}`;
}

async function listStoredSnapshotNames(
  limit = STORED_SNAPSHOT_LIST_LIMIT,
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const result = await withDeadline(
    supabase.storage.from(STORAGE_BUCKET).list(STORAGE_SNAPSHOT_PREFIX, {
      limit,
      offset: 0,
      sortBy: { column: "name", order: "desc" },
    }),
    PUBLISH_STORAGE_DEADLINE_MS,
    null,
  );
  if (!result) throw new Error("DARTSEE_STORAGE_LIST_TIMEOUT");
  if (result.error) {
    throw new Error("DARTSEE_STORAGE_LIST_FAILED");
  }
  return result.data
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name && name.endsWith(".json")));
}

async function downloadSnapshotPath(
  path: string,
): Promise<DartseeLaneSnapshot | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const result = await withDeadline(
    supabase.storage.from(STORAGE_BUCKET).download(path),
    PUBLISH_STORAGE_DEADLINE_MS,
    null,
  );
  if (!result) throw new Error("DARTSEE_STORAGE_READ_TIMEOUT");
  if (result.error) return null;
  const text = await withDeadline(
    result.data.text(),
    PUBLISH_STORAGE_DEADLINE_MS,
    "",
  );
  if (!text) throw new Error("DARTSEE_STORAGE_PARSE_FAILED");
  const parsed: unknown = JSON.parse(text);
  if (!isStoredSnapshot(parsed)) {
    throw new Error("DARTSEE_STORAGE_INVALID_SNAPSHOT");
  }
  return {
    ...parsed,
    // Stored snapshots from before the lane-map correction retain valid live
    // board state, but their venue-facing lane numbers need to be rebased.
    lanes: normalizeDartseeLaneIdentities(parsed.lanes, boardIds()),
  };
}

async function downloadStoredSnapshotUncached(): Promise<DartseeLaneSnapshot | null> {
  const names = await listStoredSnapshotNames(3);
  for (const name of names) {
    try {
      const snapshot = await downloadSnapshotPath(
        `${STORAGE_SNAPSHOT_PREFIX}/${name}`,
      );
      if (snapshot) return snapshot;
    } catch {
      // An older immutable snapshot can still provide safe last-known state.
    }
  }
  if (names.length) return null;
  // Read the former fixed object only while migrating installations that do
  // not yet have an immutable snapshot publication.
  return downloadSnapshotPath(STORAGE_PATH);
}

async function pruneStoredSnapshots() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    const names = await listStoredSnapshotNames();
    const stalePaths = names
      .slice(STORED_SNAPSHOT_RETAIN_COUNT)
      .map((name) => `${STORAGE_SNAPSHOT_PREFIX}/${name}`);
    if (!stalePaths.length) return;
    await withDeadline(
      supabase.storage.from(STORAGE_BUCKET).remove(stalePaths),
      PUBLISH_STORAGE_DEADLINE_MS,
      null,
    );
  } catch {
    // Retention is best effort; immutable publication ordering remains safe.
  }
}

interface SnapshotPublicationResult {
  winner: DartseeLaneSnapshot | null;
  settled: boolean;
}

const UNSETTLED_SNAPSHOT_PUBLICATION: SnapshotPublicationResult = {
  winner: null,
  settled: false,
};

async function saveStoredSnapshot(
  candidate: DartseeLaneSnapshot,
): Promise<SnapshotPublicationResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { winner: candidate, settled: true };
  let snapshot = candidate;
  let stored: DartseeLaneSnapshot | null = null;
  try {
    stored = await downloadStoredSnapshotUncached();
    snapshot = mergeDartseeControlGuards(snapshot, stored);
    if (stored && compareDartseeSnapshotVersions(stored, snapshot) >= 0) {
      return { winner: stored, settled: true };
    }
  } catch {
    // Immutable filenames make an upload safe even when the comparison read
    // is temporarily unavailable. A final read below decides what to cache.
  }

  try {
    const result = await withDeadline(
      supabase.storage.from(STORAGE_BUCKET).upload(
        snapshotStoragePath(snapshot),
        JSON.stringify(snapshot),
        { contentType: "application/json", upsert: false },
      ),
      PUBLISH_STORAGE_DEADLINE_MS,
      null,
    );
    if (!result || result.error) {
      return { winner: stored, settled: false };
    }

    let winner: DartseeLaneSnapshot | null = null;
    try {
      winner = await downloadStoredSnapshotUncached();
    } catch {
      // The immutable object is safe, but force a near-term read before
      // extending any in-isolate cache when its global rank is unconfirmed.
    }
    await pruneStoredSnapshots();
    if (!winner) return { winner: snapshot, settled: false };
    return { winner, settled: true };
  } catch {
    return { winner: stored, settled: false };
  }
}

async function acquireRefreshLease(): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return true;
  const bucket = Math.floor(Date.now() / REFRESH_LEASE_WINDOW_MS);
  const lockPath = `${STORAGE_LOCK_PREFIX}-${bucket}.json`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
    lockPath,
    JSON.stringify({ acquiredAt: new Date().toISOString() }),
    { contentType: "application/json", upsert: false },
  );
  if (error) return false;

  // Keep lock storage bounded. Failure to remove an old lease is harmless.
  await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([
      `${STORAGE_LOCK_PREFIX}-${bucket - 1}.json`,
      `${STORAGE_LOCK_PREFIX}-${bucket - 2}.json`,
    ]);
  return true;
}

interface DartseeStartLease {
  lane: number;
  paths: string[];
}

const DARTSEE_CONTROL_LEASE_UNAVAILABLE = Symbol(
  "DARTSEE_CONTROL_LEASE_UNAVAILABLE",
);
type DartseeStartLeaseAcquisition =
  | DartseeStartLease
  | null
  | typeof DARTSEE_CONTROL_LEASE_UNAVAILABLE;

async function acquireStartLease(
  lane: number,
  requestId: string,
): Promise<DartseeStartLeaseAcquisition> {
  const now = Date.now();
  if ((localStartGuards.get(lane) ?? 0) > now) return null;
  localStartGuards.set(lane, now + START_LEASE_WINDOW_MS * 3);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    localStartGuards.delete(lane);
    return DARTSEE_CONTROL_LEASE_UNAVAILABLE;
  }

  // Claim this time bucket and the next three. Adjacent requests on opposite
  // boundaries still contend for a shared object. Four adjacent 10-second
  // buckets provide 30–40 seconds of durable coverage, matching the staff
  // client's 30-second verification lock while safely outliving the bounded
  // full-board End preflight. A crashed request then expires without permanent
  // cleanup or manual intervention.
  const bucket = Math.floor(now / START_LEASE_WINDOW_MS);
  const paths = [bucket, bucket + 1, bucket + 2, bucket + 3].map(
    (value) => `${START_LOCK_PREFIX}/lane-${lane}-${value}.json`,
  );
  // All four unique objects must be ours before a command can be sent. Upload
  // them concurrently so the durable cross-boundary lease costs one storage
  // round trip instead of four. Concurrent contenders can split the objects,
  // but then neither owns every path and both fail closed without a command.
  const acquisitionResults = await Promise.all(
    paths.map(async (path) => ({
      path,
      acquired: await withDeadline(
        (async () => {
          try {
            const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
              path,
              JSON.stringify({
                requestId,
                acquiredAt: new Date(now).toISOString(),
              }),
              { contentType: "application/json", upsert: false },
            );
            return !error;
          } catch {
            return false;
          }
        })(),
        START_STORAGE_DEADLINE_MS,
        false,
      ),
    })),
  );
  const acquired = acquisitionResults
    .filter((result) => result.acquired)
    .map((result) => result.path);
  if (acquired.length !== paths.length) {
    if (acquired.length) {
      void withDeadline(
        supabase.storage.from(STORAGE_BUCKET).remove(acquired),
        START_STORAGE_DEADLINE_MS,
        null,
      ).catch(() => {
        // The short time-bucket lease expires without cleanup.
      });
    }
    localStartGuards.delete(lane);
    return null;
  }

  // Old time-bucket locks are inert, but remove a few to keep storage tidy.
  // Cleanup is never on the control critical path.
  void withDeadline(
    supabase.storage.from(STORAGE_BUCKET).remove(
      [bucket - 2, bucket - 3].map(
        (value) => `${START_LOCK_PREFIX}/lane-${lane}-${value}.json`,
      ),
    ),
    START_STORAGE_DEADLINE_MS,
    null,
  ).catch(() => {
    // Old bucket objects are already inert and can be cleaned up later.
  });
  return { lane, paths: acquired };
}

async function releaseStartLease(lease: DartseeStartLease) {
  localStartGuards.delete(lease.lane);
  if (!lease.paths.length) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await withDeadline(
      supabase.storage.from(STORAGE_BUCKET).remove(lease.paths),
      START_STORAGE_DEADLINE_MS,
      null,
    );
  } catch {
    // The time-bucket objects expire as locks even if cleanup is unavailable.
  }
}

function mergeLastKnown(
  current: DartseeLaneSnapshot,
  previous: DartseeLaneSnapshot | null,
): DartseeLaneSnapshot {
  const guardedCurrent = mergeDartseeControlGuards(current, previous);
  if (!previous || guardedCurrent.healthStatus === "ok") {
    return { ...guardedCurrent, consecutiveIncompleteRefreshes: 0 };
  }
  const previousByBoard = new Map(previous.lanes.map((lane) => [lane.boardId, lane]));
  const previousAgeSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(previous.capturedAt).getTime()) / 1000),
  );
  const consecutiveIncompleteRefreshes =
    (previous.consecutiveIncompleteRefreshes ?? 0) + 1;
  const transientPartial =
    guardedCurrent.healthStatus === "partial" &&
    consecutiveIncompleteRefreshes < 20;
  const unresponsiveLaneNumbers = guardedCurrent.lanes
    .filter((lane) => guardedCurrent.unresponsiveBoardIds?.includes(lane.boardId))
    .map((lane) => lane.lane);
  const machineMessage = unresponsiveLaneNumbers.length
    ? `Dart lane${unresponsiveLaneNumbers.length === 1 ? "" : "s"} ${unresponsiveLaneNumbers.join(", ")} ${unresponsiveLaneNumbers.length === 1 ? "is" : "are"} not responding. Staff should go check the Dartsee machine.`
    : guardedCurrent.healthMessage ?? "Dartsee feed needs attention";
  return {
    ...guardedCurrent,
    lanes: guardedCurrent.lanes.map((lane) => {
      if (lane.status !== "unknown") return lane;
      const retained = previousByBoard.get(lane.boardId);
      if (!retained) return lane;
      if (retained.status !== "occupied") return retained;
      const remainingSeconds = Math.max(0, retained.remainingSeconds - previousAgeSeconds);
      return remainingSeconds > 0
        ? { ...retained, remainingSeconds }
        : { ...retained, status: "open", remainingSeconds: 0 };
    }),
    // One Dartsee board occasionally answers a heartbeat a few seconds late.
    // Preserve its last-known state immediately, but only alert staff after
    // a sustained five-minute outage. Auth and connection failures still
    // alert immediately.
    healthStatus: transientPartial ? "ok" : guardedCurrent.healthStatus,
    healthMessage: transientPartial
      ? undefined
      : `${machineMessage} Last known status is retained for unreadable lanes.`,
    consecutiveIncompleteRefreshes,
  };
}

function startConfirmationMatches(
  lane: DartseeLaneReading | null,
  expectedEndMs: number,
): lane is DartseeLaneReading {
  if (!lane || lane.status !== "occupied" || !lane.sessionEnd) return false;
  const endMs = new Date(lane.sessionEnd).getTime();
  return (
    Number.isFinite(endMs) &&
    Math.abs(endMs - expectedEndMs) <= START_CONFIRM_END_TOLERANCE_MS
  );
}

async function controlReadWithFreshAuth<T>(
  read: (token: string) => Promise<T | null>,
): Promise<{ token: string; value: T } | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) authCache = null;
    try {
      const token = await getAccessToken(5_000);
      if (!token) continue;
      const value = await read(token);
      if (value) return { token, value };
    } catch {
      // One fresh-login/read-only retry is safe before a physical command.
    }
  }
  authCache = null;
  return null;
}

async function openDartseeControlObserverWithFreshAuth(
  ids: string[],
  preflightTimeoutMs: number,
): Promise<{
  token: string;
  observer: DartseeControlObserver;
} | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) authCache = null;
    try {
      const token = await getAccessToken(5_000);
      if (!token) continue;
      const observer = await openDartseeControlObserver(
        ids,
        token,
        preflightTimeoutMs,
      );
      if (observer) return { token, observer };
    } catch {
      // A fresh-login retry is read-only and occurs before any physical action.
    }
  }
  authCache = null;
  return null;
}

async function publishConfirmedDartseeLaneStateWithToken(
  token: string,
  confirmedLane: DartseeLaneReading,
  confirmedAtMs: number,
): Promise<DartseeLaneSnapshot | null> {
  const publicationStartedAt = Date.now();
  const ids = boardIds();
  let previous = await withDeadline(
    getStoredSnapshot(),
    START_STORAGE_DEADLINE_MS,
    snapshotCache?.snapshot ?? null,
  );
  const cacheMs = envNumber("DARTSEE_CACHE_MS", 15000);
  const refreshAgeMs = refreshTargetAgeMs(cacheMs);

  if (previous) {
    // Publish the exact socket-confirmed lane immediately on a complete,
    // countdown-rebased venue snapshot. The short guard prevents a newly
    // opened dashboard socket from replacing it with Dartsee's cached
    // pre-control echo while preserving every other lane.
    const confirmedSnapshot = snapshotWithConfirmedDartseeControl(
      previous,
      confirmedLane,
      confirmedAtMs,
    );
    const confirmedPublication = await withDeadline(
      saveStoredSnapshot(confirmedSnapshot),
      START_STORAGE_DEADLINE_MS,
      UNSETTLED_SNAPSHOT_PUBLICATION,
    );
    previous = mergeDartseeControlGuards(
      confirmedPublication.winner ?? confirmedSnapshot,
      confirmedSnapshot,
    );
    const confirmedCacheMs = confirmedPublication.settled
      ? cacheMs
      : LEASE_LOSER_RETRY_MS;
    rememberSnapshot(previous, confirmedCacheMs);
  }

  const initial = await readLiveSnapshot(ids, token, 5_000);
  if (!initial) {
    nextRefreshAttemptAt = Date.now() + LEASE_LOSER_RETRY_MS;
    return previous;
  }

  // A post-control socket can briefly echo Dartsee's cached pre-control state.
  // Local capture time alone is not proof of a later lane change; the control
  // guard below requires matching state, a distinct session, or expiry.
  const live = await retryMissingBoards(initial, token);
  const liveVersionMs = new Date(
    live.stateVersionAt ?? live.capturedAt,
  ).getTime();
  if (
    live.healthStatus !== "ok" ||
    live.knownLaneCount !== ids.length ||
    !live.lanes.some((lane) => lane.boardId === confirmedLane.boardId) ||
    !Number.isFinite(liveVersionMs) ||
    liveVersionMs < confirmedAtMs
  ) {
    nextRefreshAttemptAt = Date.now() + LEASE_LOSER_RETRY_MS;
    return previous;
  }

  const snapshot = mergeLastKnown(live, previous);
  const publication = await withDeadline(
    saveStoredSnapshot(snapshot),
    START_STORAGE_DEADLINE_MS,
    UNSETTLED_SNAPSHOT_PUBLICATION,
  );
  const winner =
    publication.winner ?? previous ?? snapshotCache?.snapshot ?? snapshot;
  const winnerCacheMs = publication.settled
    ? cacheMs
    : LEASE_LOSER_RETRY_MS;
  rememberSnapshot(winner, winnerCacheMs);
  nextRefreshAttemptAt = publication.settled
    ? nextSnapshotRefreshAt(winner, refreshAgeMs, publicationStartedAt)
    : Date.now() + LEASE_LOSER_RETRY_MS;
  return winner;
}

export async function publishConfirmedDartseeStart(
  confirmedLane: DartseeLaneReading,
  confirmedAtMs = Date.now(),
): Promise<void> {
  try {
    const token = await getAccessToken(5_000);
    if (!token) return;
    await publishConfirmedDartseeLaneStateWithToken(
      token,
      confirmedLane,
      confirmedAtMs,
    );
  } catch {
    // The staff UI already holds the confirmed lane. A normal feed refresh will
    // retry durable publication without changing the completed control action.
  }
}

export async function publishConfirmedDartseeEnd(
  confirmedLane: DartseeLaneReading,
  confirmedAtMs = Date.now(),
): Promise<void> {
  try {
    const token = await getAccessToken(5_000);
    if (!token) return;
    await publishConfirmedDartseeLaneStateWithToken(
      token,
      confirmedLane,
      confirmedAtMs,
    );
  } catch {
    // The staff UI already holds the confirmed open lane. A normal feed refresh
    // will retry durable publication without changing the completed action.
  }
}

/**
 * An ambiguous control may already have reached Dartsee. Refresh shared state
 * after a short settle delay without ever resending the physical command.
 */
export async function refreshDartseeLaneSnapshotAfterControl(): Promise<void> {
  const refreshStartedAt = Date.now();
  try {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const ids = boardIds();
    const refreshed = await controlReadWithFreshAuth(async (token) => {
      const initial = await readLiveSnapshot(ids, token, 5_000);
      return initial ? retryMissingBoards(initial, token) : null;
    });
    if (!refreshed) return;
    const previous = await withDeadline(
      getStoredSnapshot(),
      START_STORAGE_DEADLINE_MS,
      snapshotCache?.snapshot ?? null,
    );
    const snapshot = mergeLastKnown(refreshed.value, previous);
    const publication = await withDeadline(
      saveStoredSnapshot(snapshot),
      START_STORAGE_DEADLINE_MS,
      UNSETTLED_SNAPSHOT_PUBLICATION,
    );
    const winner =
      publication.winner ?? previous ?? snapshotCache?.snapshot ?? snapshot;
    const cacheMs = envNumber("DARTSEE_CACHE_MS", 15000);
    const winnerCacheMs = publication.settled
      ? cacheMs
      : LEASE_LOSER_RETRY_MS;
    rememberSnapshot(winner, winnerCacheMs);
    nextRefreshAttemptAt = publication.settled
      ? nextSnapshotRefreshAt(
          winner,
          refreshTargetAgeMs(cacheMs),
          refreshStartedAt,
        )
      : Date.now() + LEASE_LOSER_RETRY_MS;
  } catch {
    // Normal feed polling remains the fallback. This path is read-only and
    // deliberately never retries a Start or End command.
  }
}

export async function startDartseeLaneSession(input: {
  requestId: string;
  lane: number;
  durationMinutes: DartseeStartDuration;
  reservationOverride: boolean;
}): Promise<DartseeLaneStartResult> {
  const timing: DartseeControlTiming = {
    startedAtMs: Date.now(),
    outcome: "invalid-configuration",
  };
  const boardId = dartseeBoardIdForLane(input.lane);
  const configuredDuration = DARTSEE_START_DURATIONS.includes(
    input.durationMinutes,
  );
  const venueId = readEnv("DARTSEE_VENUE_ID");
  if (!boardId || !configuredDuration || !venueId) {
    logDartseeControlTiming("start", timing);
    return { ok: false, code: "invalid-configuration" };
  }

  timing.outcome = "control-unavailable";
  let lease: DartseeStartLease | null = null;
  let commandMayHaveBeenSent = false;
  let retainLease = false;
  let controlObserver: DartseeControlObserver | null = null;
  try {
    // These are independent read-only/safety preparations. The physical POST
    // remains strictly after all three have succeeded and been revalidated.
    const [leaseAcquisition, preflight, schedule] = await Promise.all([
      acquireStartLease(input.lane, input.requestId).catch(
        (): typeof DARTSEE_CONTROL_LEASE_UNAVAILABLE =>
          DARTSEE_CONTROL_LEASE_UNAVAILABLE,
      ),
      openDartseeControlObserverWithFreshAuth([boardId], 3_000).catch(
        () => null,
      ),
      withDeadline(
        getStoredEntertainmentSchedule(),
        START_SCHEDULE_READ_DEADLINE_MS,
        null,
      ).catch(() => null),
    ]);
    timing.parallelReadyAtMs = Date.now();
    controlObserver = preflight?.observer ?? null;

    if (leaseAcquisition === DARTSEE_CONTROL_LEASE_UNAVAILABLE) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    lease = leaseAcquisition;
    if (!lease) {
      timing.outcome = "already-in-progress";
      return { ok: false, code: "already-in-progress" };
    }
    if (!preflight) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }
    const { token, observer } = preflight;
    const before = observer.lanes()[0];
    if (before.status !== "open") {
      const code: DartseeLaneStartFailureCode =
        before.status === "occupied" ? "lane-occupied" : "feed-unavailable";
      timing.outcome = code;
      return {
        ok: false,
        code,
      };
    }

    // Re-check schedule freshness and overlap after the live probe so the
    // authorization decision is made immediately before the external write.
    const scheduleAt = schedule
      ? new Date(schedule.fetchedAt).getTime()
      : Number.NaN;
    if (
      !schedule ||
      !Number.isFinite(scheduleAt) ||
      Date.now() - scheduleAt > START_SCHEDULE_MAX_AGE_MS
    ) {
      timing.outcome = "schedule-unavailable";
      return { ok: false, code: "schedule-unavailable" };
    }
    const startMs = Date.now();
    const commandDurationMinutes = dartseeCommandDurationMinutes(
      input.durationMinutes,
    );
    const expectedEndMs = startMs + commandDurationMinutes * 60_000;
    const resourceIds = [`darts-${input.lane}`, `dart-${input.lane}`];
    const conflict = schedule.reservations.find(
      (reservation) =>
        resourceIds.includes(reservation.resourceId.toLowerCase()) &&
        reservationConflictsWithSession(reservation, startMs, expectedEndMs),
    );
    if (conflict && !input.reservationOverride) {
      timing.outcome = "reservation-conflict";
      return {
        ok: false,
        code: "reservation-conflict",
        conflict: {
          eventName: conflict.eventName,
          startAt: conflict.startAt,
        },
      };
    }

    // The observer remains live while schedule protection is checked. Refuse
    // the write if another controller started this board in that interval.
    const immediatelyBeforeWrite = observer.lanes().find(
      (lane) => lane.boardId === boardId,
    );
    if (immediatelyBeforeWrite?.status !== "open") {
      const code: DartseeLaneStartFailureCode =
        immediatelyBeforeWrite?.status === "occupied"
          ? "lane-occupied"
          : "feed-unavailable";
      timing.outcome = code;
      return {
        ok: false,
        code,
      };
    }

    let response: Response | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), START_POST_TIMEOUT_MS);
    const commandIssuedAtMs = Date.now();
    timing.postStartedAtMs = commandIssuedAtMs;
    try {
      commandMayHaveBeenSent = true;
      response = await fetch(`${baseUrl()}/v2.0/tournaments/walk-in`, {
        method: "POST",
        // Never forward the Dartsee bearer token to a redirect destination.
        // Cloudflare Workers support manual redirects, while `error` can
        // reject this subrequest before it leaves the Worker.
        redirect: "manual",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          length: commandDurationMinutes,
          boardIds: [boardId],
          maxPlayers: 8,
          venueId,
          name: "walk-in",
        }),
        signal: controller.signal,
      });
    } catch {
      timing.postResult = "request-failed";
      // A network error or timeout is ambiguous. Never resend the POST; verify
      // the resulting live state below instead.
    } finally {
      clearTimeout(timer);
      timing.postFinishedAtMs = Date.now();
    }

    if (response) {
      timing.postResult = response.status < 300
        ? "response-2xx"
        : response.status < 400
          ? "response-3xx"
          : response.status < 500
            ? "response-4xx"
            : "response-5xx";
    }

    if (response?.body) {
      try {
        await response.body.cancel();
      } catch {
        // The status is sufficient; never surface or log the upstream body.
      }
    }

    if (response && response.status >= 300 && response.status < 500) {
      if (response.status === 401 || response.status === 403) authCache = null;
      timing.outcome = "control-rejected";
      return { ok: false, code: "control-rejected" };
    }

    const reading = await observer.waitForLane(
      boardId,
      commandIssuedAtMs,
      (lane) => startConfirmationMatches(lane, expectedEndMs),
    );
    timing.confirmationFinishedAtMs = Date.now();
    const confirmedLane = startConfirmationMatches(reading, expectedEndMs)
      ? { ...reading, lane: input.lane }
      : null;

    if (!confirmedLane) {
      // Keep the lease until its time buckets expire. The command may have
      // reached Dartsee, so staff must refresh/check the lane before retrying.
      retainLease = true;
      timing.outcome = "unconfirmed";
      return {
        ok: true,
        confirmed: false,
        checkedAt: new Date().toISOString(),
        lane: null,
        snapshot: null,
      };
    }

    timing.outcome = "confirmed";
    return {
      ok: true,
      confirmed: true,
      checkedAt: new Date().toISOString(),
      lane: confirmedLane,
      snapshot: null,
    };
  } catch {
    if (!commandMayHaveBeenSent) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    // Once the POST may have left this process, errors are ambiguous and must
    // never trigger an automatic retry.
    retainLease = true;
    timing.outcome = "unconfirmed";
    return {
      ok: true,
      confirmed: false,
      checkedAt: new Date().toISOString(),
      lane: null,
      snapshot: null,
    };
  } finally {
    controlObserver?.close();
    if (lease && !retainLease) await releaseStartLease(lease);
    logDartseeControlTiming("start", timing);
  }
}

/**
 * Perform the explicit staff override without trusting the browser to choose
 * the physical Dartsee operation. A fresh complete venue view determines
 * whether the requested lane needs a new walk-in or an exact single-lane
 * session extension. Reservation conflicts are intentionally bypassed here;
 * every other live-feed, schedule-freshness, duplicate, and session-identity
 * gate remains fail-closed.
 */
export async function overrideDartseeLaneSession(input: {
  requestId: string;
  lane: number;
  durationMinutes: number;
}): Promise<DartseeLaneOverrideResult> {
  const timing: DartseeControlTiming = {
    startedAtMs: Date.now(),
    outcome: "invalid-configuration",
  };
  const boardId = dartseeBoardIdForLane(input.lane);
  const ids = boardIds();
  const venueId = readEnv("DARTSEE_VENUE_ID");
  if (
    !boardId ||
    ids.length !== 5 ||
    new Set(ids).size !== 5 ||
    !isDartseeOverrideDuration(input.durationMinutes) ||
    !venueId
  ) {
    logDartseeControlTiming("override", timing);
    return { ok: false, code: "invalid-configuration" };
  }

  timing.outcome = "control-unavailable";
  let lease: DartseeStartLease | null = null;
  let commandMayHaveBeenSent = false;
  let retainLease = false;
  let controlObserver: DartseeControlObserver | null = null;
  let action: DartseeLaneOverrideAction = "start";
  let expectedSessionId: string | undefined;
  let expectedSessionEnd: string | undefined;
  try {
    const [leaseAcquisition, fullPreflight, schedule] = await Promise.all([
      acquireStartLease(input.lane, input.requestId).catch(
        (): typeof DARTSEE_CONTROL_LEASE_UNAVAILABLE =>
          DARTSEE_CONTROL_LEASE_UNAVAILABLE,
      ),
      openDartseeControlObserverWithFreshAuth(ids, 5_000).catch(() => null),
      withDeadline(
        getStoredEntertainmentSchedule(),
        START_SCHEDULE_READ_DEADLINE_MS,
        null,
      ).catch(() => null),
    ]);
    timing.parallelReadyAtMs = Date.now();
    controlObserver = fullPreflight?.observer ?? null;

    if (leaseAcquisition === DARTSEE_CONTROL_LEASE_UNAVAILABLE) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    lease = leaseAcquisition;
    if (!lease) {
      timing.outcome = "already-in-progress";
      return { ok: false, code: "already-in-progress" };
    }
    if (!fullPreflight) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }
    const { token, observer } = fullPreflight;

    // A linked-session frame can closely follow the first complete heartbeat.
    // Wait one short stability window before deciding whether Start or Extend
    // is the only safe lane-specific operation.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!observer.isActive()) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }

    const inspection = inspectDartseeOverrideLane(
      observer.lanes(),
      boardId,
    );
    if (!inspection.ok) {
      const code: DartseeLaneOverrideFailureCode =
        inspection.reason === "target-missing"
          ? "feed-unavailable"
          : inspection.reason;
      timing.outcome = code;
      return { ok: false, code };
    }
    action = inspection.action;

    // The override bypasses a known overlap, never an unavailable or stale
    // reservation source. That preserves the same fail-closed protection as
    // the ordinary Start control when Event Host is not current.
    const scheduleAt = schedule
      ? new Date(schedule.fetchedAt).getTime()
      : Number.NaN;
    if (
      !schedule ||
      !Number.isFinite(scheduleAt) ||
      Date.now() - scheduleAt > START_SCHEDULE_MAX_AGE_MS
    ) {
      timing.outcome = "schedule-unavailable";
      return { ok: false, code: "schedule-unavailable" };
    }

    const sessionStartMs = Date.now();
    const startCommandMinutes = dartseeCommandDurationMinutes(
      input.durationMinutes,
    );
    const expectedEndMs = inspection.action === "start"
      ? sessionStartMs + startCommandMinutes * 60_000
      : inspection.currentEndMs + input.durationMinutes * 60_000;
    expectedSessionId = inspection.action === "extend"
      ? inspection.sessionId
      : undefined;
    expectedSessionEnd = new Date(expectedEndMs).toISOString();
    const resourceIds = [`darts-${input.lane}`, `dart-${input.lane}`];
    const conflict = schedule.reservations.find(
      (reservation) =>
        resourceIds.includes(reservation.resourceId.toLowerCase()) &&
        reservationConflictsWithSession(
          reservation,
          sessionStartMs,
          expectedEndMs,
        ),
    );
    if (conflict) {
      // This route is the explicit staff override. Keep the audit useful while
      // excluding event names and all upstream/private response data.
      console.warn("[dartsee lane:override] reservation conflict overridden", {
        lane: input.lane,
        action,
        durationMinutes: input.durationMinutes,
        reservationStartAt: conflict.startAt,
      });
    }

    if (!observer.isActive()) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }
    const immediatelyBeforeWrite = inspectDartseeOverrideLane(
      observer.lanes(),
      boardId,
    );
    const unchangedStart =
      inspection.action === "start" &&
      immediatelyBeforeWrite.ok &&
      immediatelyBeforeWrite.action === "start";
    const unchangedExtension =
      inspection.action === "extend" &&
      immediatelyBeforeWrite.ok &&
      immediatelyBeforeWrite.action === "extend" &&
      immediatelyBeforeWrite.sessionId === inspection.sessionId &&
      immediatelyBeforeWrite.currentEndMs === inspection.currentEndMs &&
      immediatelyBeforeWrite.maxPlayers === inspection.maxPlayers;
    if (!unchangedStart && !unchangedExtension) {
      timing.outcome = "lane-state-changed";
      return { ok: false, code: "lane-state-changed" };
    }

    let response: Response | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), START_POST_TIMEOUT_MS);
    const commandIssuedAtMs = Date.now();
    timing.postStartedAtMs = commandIssuedAtMs;
    try {
      commandMayHaveBeenSent = true;
      if (inspection.action === "start") {
        response = await fetch(`${baseUrl()}/v2.0/tournaments/walk-in`, {
          method: "POST",
          redirect: "manual",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            length: startCommandMinutes,
            boardIds: [boardId],
            maxPlayers: 8,
            venueId,
            name: "walk-in",
          }),
          signal: controller.signal,
        });
      } else {
        response = await fetch(
          `${baseUrl()}/v2.0/tournaments/${encodeURIComponent(inspection.sessionId)}/extend?boardId=${encodeURIComponent(boardId)}`,
          {
            method: "POST",
            redirect: "manual",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            // Dartsee's dashboard sends `length` as the additional minutes,
            // not the session's new total duration. Extension therefore does
            // not receive the one-minute new-session walking buffer.
            body: JSON.stringify({
              length: input.durationMinutes,
              maxPlayers: inspection.maxPlayers,
            }),
            signal: controller.signal,
          },
        );
      }
    } catch {
      timing.postResult = "request-failed";
      // A timeout is ambiguous after the one allowed POST. Never resend it.
    } finally {
      clearTimeout(timer);
      timing.postFinishedAtMs = Date.now();
    }

    if (response) {
      timing.postResult = response.status < 300
        ? "response-2xx"
        : response.status < 400
          ? "response-3xx"
          : response.status < 500
            ? "response-4xx"
            : "response-5xx";
    }
    if (response?.body) {
      try {
        await response.body.cancel();
      } catch {
        // Live socket state, not the upstream body, proves the physical result.
      }
    }
    if (
      response &&
      isDefinitiveDartseeOverrideRejection(response.status)
    ) {
      if (response.status === 401 || response.status === 403) authCache = null;
      timing.outcome = "control-rejected";
      return { ok: false, code: "control-rejected" };
    }

    const reading = await observer.waitForLane(
      boardId,
      commandIssuedAtMs,
      inspection.action === "start"
        ? (lane) => startConfirmationMatches(lane, expectedEndMs)
        : (lane) =>
            dartseeExtensionConfirmationMatches(
              lane,
              inspection.sessionId,
              inspection.currentEndMs,
              expectedEndMs,
            ),
    );
    timing.confirmationFinishedAtMs = Date.now();
    const confirmed = inspection.action === "start"
      ? startConfirmationMatches(reading, expectedEndMs)
        : dartseeExtensionConfirmationMatches(
          reading,
          inspection.sessionId,
          inspection.currentEndMs,
          expectedEndMs,
        );
    const confirmedLane = confirmed && reading
      ? { ...reading, lane: input.lane }
      : null;

    if (!confirmedLane) {
      retainLease = true;
      timing.outcome = "unconfirmed";
      return {
        ok: true,
        action,
        confirmed: false,
        checkedAt: new Date().toISOString(),
        lane: null,
        snapshot: null,
        expectedSessionId,
        expectedSessionEnd,
      };
    }

    timing.outcome = "confirmed";
    return {
      ok: true,
      action,
      confirmed: true,
      checkedAt: new Date().toISOString(),
      lane: confirmedLane,
      snapshot: null,
      expectedSessionId,
      expectedSessionEnd,
    };
  } catch {
    if (!commandMayHaveBeenSent) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    retainLease = true;
    timing.outcome = "unconfirmed";
    return {
      ok: true,
      action,
      confirmed: false,
      checkedAt: new Date().toISOString(),
      lane: null,
      snapshot: null,
      expectedSessionId,
      expectedSessionEnd,
    };
  } finally {
    controlObserver?.close();
    if (lease && !retainLease) await releaseStartLease(lease);
    logDartseeControlTiming("override", timing);
  }
}

export async function endDartseeLaneSession(input: {
  requestId: string;
  lane: number;
}): Promise<DartseeLaneEndResult> {
  const timing: DartseeControlTiming = {
    startedAtMs: Date.now(),
    outcome: "invalid-configuration",
  };
  const boardId = dartseeBoardIdForLane(input.lane);
  if (!boardId) {
    logDartseeControlTiming("end", timing);
    return { ok: false, code: "invalid-configuration" };
  }

  timing.outcome = "control-unavailable";
  let lease: DartseeStartLease | null = null;
  let commandMayHaveBeenSent = false;
  let retainLease = false;
  let controlObserver: DartseeControlObserver | null = null;
  try {
    const ids = boardIds();
    // The durable duplicate guard and complete five-board read are independent
    // safety preparations, so perform them concurrently. End remains blocked
    // until both have succeeded.
    const [leaseAcquisition, fullPreflight] = await Promise.all([
      acquireStartLease(input.lane, input.requestId).catch(
        (): typeof DARTSEE_CONTROL_LEASE_UNAVAILABLE =>
          DARTSEE_CONTROL_LEASE_UNAVAILABLE,
      ),
      openDartseeControlObserverWithFreshAuth(ids, 5_000).catch(() => null),
    ]);
    timing.parallelReadyAtMs = Date.now();
    controlObserver = fullPreflight?.observer ?? null;

    if (leaseAcquisition === DARTSEE_CONTROL_LEASE_UNAVAILABLE) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    lease = leaseAcquisition;
    if (!lease) {
      timing.outcome = "already-in-progress";
      return { ok: false, code: "already-in-progress" };
    }
    if (!fullPreflight) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }
    const { token, observer } = fullPreflight;

    // Initial dashboard frames for the five boards can arrive back-to-back.
    // Give that complete venue view one short stability window so a linked
    // session frame cannot trail the first known status into an unsafe End.
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!observer.isActive()) {
      timing.outcome = "feed-unavailable";
      return { ok: false, code: "feed-unavailable" };
    }

    // This is the final pre-write read. The browser never supplies a board ID
    // or session ID, and the complete uncached five-board view ensures a shared
    // multi-board session cannot be mistaken for a safe single-lane End.
    const inspection = inspectDartseeEndSession(
      observer.lanes(),
      boardId,
    );
    if (!inspection.ok) {
      if (inspection.reason === "target-missing") {
        timing.outcome = "feed-unavailable";
        return { ok: false, code: "feed-unavailable" };
      }
      const code: DartseeLaneEndFailureCode =
        inspection.reason === "lane-open"
          ? "lane-open"
          : inspection.reason;
      timing.outcome = code;
      return {
        ok: false,
        code,
      };
    }
    const sessionId = inspection.sessionId;

    let response: Response | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), START_POST_TIMEOUT_MS);
    const commandIssuedAtMs = Date.now();
    timing.postStartedAtMs = commandIssuedAtMs;
    try {
      commandMayHaveBeenSent = true;
      response = await fetch(
        `${baseUrl()}/v2.0/tournaments/${encodeURIComponent(sessionId)}/stop?boardId=${encodeURIComponent(boardId)}`,
        {
          method: "POST",
          // Match Start: do not forward the bearer token across redirects.
          redirect: "manual",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        },
      );
    } catch {
      timing.postResult = "request-failed";
      // A network error or timeout is ambiguous. Never send a second End;
      // verify the exact board's live state below instead.
    } finally {
      clearTimeout(timer);
      timing.postFinishedAtMs = Date.now();
    }
    if (response) {
      timing.postResult = response.status < 300
        ? "response-2xx"
        : response.status < 400
          ? "response-3xx"
          : response.status < 500
            ? "response-4xx"
            : "response-5xx";
    }

    if (response?.body) {
      try {
        await response.body.cancel();
      } catch {
        // The live lane recheck, not an upstream response body, proves End.
      }
    }
    if (response && response.status >= 300 && response.status < 500) {
      if (response.status === 401 || response.status === 403) authCache = null;
      timing.outcome = "control-rejected";
      return { ok: false, code: "control-rejected" };
    }

    const reading = await observer.waitForLane(
      boardId,
      commandIssuedAtMs,
      (lane) => lane.status === "open",
    );
    timing.confirmationFinishedAtMs = Date.now();
    const confirmedLane = reading?.status === "open"
      ? { ...reading, lane: input.lane }
      : null;
    if (!confirmedLane) {
      // Keep the short lease until its buckets expire. The End may have reached
      // Dartsee, so the staff UI must verify rather than offer an immediate retry.
      retainLease = true;
      timing.outcome = "unconfirmed";
      return {
        ok: true,
        confirmed: false,
        checkedAt: new Date().toISOString(),
        lane: null,
        snapshot: null,
      };
    }

    timing.outcome = "confirmed";
    return {
      ok: true,
      confirmed: true,
      checkedAt: new Date().toISOString(),
      lane: confirmedLane,
      snapshot: null,
    };
  } catch {
    if (!commandMayHaveBeenSent) {
      timing.outcome = "control-unavailable";
      return { ok: false, code: "control-unavailable" };
    }
    retainLease = true;
    timing.outcome = "unconfirmed";
    return {
      ok: true,
      confirmed: false,
      checkedAt: new Date().toISOString(),
      lane: null,
      snapshot: null,
    };
  } finally {
    controlObserver?.close();
    if (lease && !retainLease) await releaseStartLease(lease);
    logDartseeControlTiming("end", timing);
  }
}

export async function getDartseeLaneSnapshot(): Promise<DartseeLaneSnapshot | null> {
  const cacheMs = envNumber("DARTSEE_CACHE_MS", 15000);
  const refreshAgeMs = refreshTargetAgeMs(cacheMs);
  const startedAt = Date.now();
  if (
    snapshotCache &&
    startedAt < snapshotCache.expiresAt &&
    snapshotAgeMs(snapshotCache.snapshot, startedAt) < refreshAgeMs
  ) {
    return snapshotCache.snapshot;
  }

  // Set this before the first await so another request in the same isolate
  // returns cached data instead of sharing this request's I/O or starting a
  // second storage/login/WebSocket chain.
  if (startedAt < nextRefreshAttemptAt) {
    return snapshotCache?.snapshot ?? null;
  }
  nextRefreshAttemptAt = startedAt + REFRESH_IN_FLIGHT_GUARD_MS;

  let stored: DartseeLaneSnapshot | null = snapshotCache?.snapshot ?? null;
  try {
    // The storage snapshot is shared across Worker isolates. Reading it before
    // connecting prevents every customer/staff poll from opening a separate
    // Dartsee login and WebSocket during busy periods.
    stored = await getStoredSnapshot();
    if (stored && snapshotAgeMs(stored) < refreshAgeMs) {
      rememberSnapshot(stored, cacheMs);
      nextRefreshAttemptAt = nextSnapshotRefreshAt(
        stored,
        refreshAgeMs,
        startedAt,
      );
      return stored;
    }

    const ownsRefresh = await acquireRefreshLease();
    if (!ownsRefresh) {
      // The owner will publish to durable storage. A loser must not sleep or
      // reread storage inside `after()`; the next normal poll will see it.
      nextRefreshAttemptAt = Date.now() + LEASE_LOSER_RETRY_MS;
      return stored;
    }

    const token = await getAccessToken();
    if (!token) {
      nextRefreshAttemptAt = Date.now() + REFRESH_ERROR_RETRY_MS;
      return stored;
    }
    const initialSnapshot = await readLiveSnapshot(boardIds(), token);
    const liveSnapshot = initialSnapshot
      ? await retryMissingBoards(initialSnapshot, token)
      : null;
    if (!liveSnapshot) {
      nextRefreshAttemptAt = Date.now() + REFRESH_ERROR_RETRY_MS;
      return stored;
    }
    const snapshot = mergeLastKnown(
      liveSnapshot,
      stored ?? snapshotCache?.snapshot ?? null,
    );
    const publication = await saveStoredSnapshot(snapshot);
    const winner =
      publication.winner ?? stored ?? snapshotCache?.snapshot ?? snapshot;
    const winnerCacheMs = publication.settled
      ? cacheMs
      : LEASE_LOSER_RETRY_MS;
    rememberSnapshot(winner, winnerCacheMs);
    nextRefreshAttemptAt = publication.settled
      ? nextSnapshotRefreshAt(winner, refreshAgeMs, startedAt)
      : Date.now() + LEASE_LOSER_RETRY_MS;
    return winner;
  } catch (err) {
    const authFailure = isDartseeAuthorizationError(err);
    console.error(
      `[dartsee lanes] ${authFailure ? "authorization" : "connection"} refresh failure`,
    );
    if (authFailure) authCache = null;
    const previous = stored ?? snapshotCache?.snapshot ?? null;
    nextRefreshAttemptAt = Date.now() + REFRESH_ERROR_RETRY_MS;
    if (!previous) {
      rememberSnapshot(null, Math.min(cacheMs, REFRESH_ERROR_RETRY_MS));
      return null;
    }
    const now = new Date().toISOString();
    const failureSnapshot: DartseeLaneSnapshot = {
      ...previous,
      receivedAt: now,
      healthStatus: authFailure ? "auth-error" : "connection-error",
      healthMessage: authFailure
        ? "Dartsee authentication failed. Last known lane status is shown. Verify the Dartsee account configuration."
        : "Dartsee refresh was interrupted. Last known lane status is retained while the connection retries.",
      healthUpdatedAt: now,
      consecutiveIncompleteRefreshes:
        (previous.consecutiveIncompleteRefreshes ?? 0) + 1,
    };
    // Immutable ordering lets a newer healthy publisher win this race. When
    // the failure is newest, persist its count so sustained-warning logic is
    // consistent across Worker isolates without replacing last-known lanes.
    let visibleSnapshot = failureSnapshot;
    try {
      const publication = await saveStoredSnapshot(failureSnapshot);
      visibleSnapshot = publication.winner ?? failureSnapshot;
    } catch {
      // Keep the in-isolate failure count and last-known lanes even if the
      // shared cache is the dependency that failed.
    }
    rememberSnapshot(
      visibleSnapshot,
      Math.min(cacheMs, REFRESH_ERROR_RETRY_MS),
    );
    return visibleSnapshot;
  }
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
  const unresponsiveBoards = new Set(snapshot.unresponsiveBoardIds ?? []);

  return snapshot.lanes.map((lane) => ({
    // Schedule resources use venue-facing lane numbers, not Dartsee hardware
    // board IDs. Keep board IDs on the snapshot, but schedule and queue math
    // must share the canonical numbered resource ID.
    id: String(lane.lane),
    label: `Dart ${lane.lane}`,
    availableAtSeconds:
      unresponsiveBoards.has(lane.boardId)
        ? Number.POSITIVE_INFINITY
        : lane.status === "open"
        ? 0
        : lane.status === "occupied"
          ? Math.max(0, lane.remainingSeconds - elapsedSeconds)
          : Number.POSITIVE_INFINITY,
  }));
}
