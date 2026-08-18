export const DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID =
  "zone_01kagmx6mnf4ate09115a73cys";
export const DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID =
  "ven_01he2x75nmeey8m93b5madk9et";
export const DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_VENUE_ID = 8470;
export const DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_QUEUE_ID = 8418;
export const DEFAULT_SINGA_PUBLIC_STAGE_QUEUE_ID =
  "que_01he2x7e45esq8r2fve7vh3c88";
export const DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL =
  "https://onpar-singa-relay.vercel.app/api/wait";
export const SINGA_PUBLIC_STAGE_TIMEOUT_MS = 5_000;
export const SINGA_PUBLIC_STAGE_CACHE_MS = 10_000;
export const SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS = 180_000;

const SINGA_ZONE_ID_PATTERN = /^zone_[a-z0-9]{26}$/;
const SINGA_VENUE_ID_PATTERN = /^ven_[a-z0-9]{26}$/;
const SINGA_QUEUE_ID_PATTERN = /^que_[a-z0-9]{26}$/;

type JsonRecord = Record<string, unknown>;

export type SingaPublicStageFreshWait =
  | {
      status: "active";
      waitMinutes: number;
      stale: false;
      checkedAt: string;
      dataUpdatedAt: string;
    }
  | {
      status: "inactive";
      waitMinutes: null;
      stale: false;
      checkedAt: string;
      dataUpdatedAt: string;
    };

export interface SingaPublicStageLastKnown {
  status: "active" | "inactive";
  waitMinutes: number | null;
  dataUpdatedAt: string;
}

export interface SingaPublicStageUnavailableWait {
  status: "unavailable";
  waitMinutes: null;
  stale: boolean;
  checkedAt: string;
  dataUpdatedAt: string | null;
  lastKnown: SingaPublicStageLastKnown | null;
}

export type SingaPublicStageWait =
  | SingaPublicStageFreshWait
  | SingaPublicStageUnavailableWait;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isValidSingaZoneId(value: string): boolean {
  return SINGA_ZONE_ID_PATTERN.test(value);
}

export function isValidSingaVenueId(value: string): boolean {
  return SINGA_VENUE_ID_PATTERN.test(value);
}

export function isValidSingaQueueId(value: string): boolean {
  return SINGA_QUEUE_ID_PATTERN.test(value);
}

/**
 * Parse the aggregate queue published for legacy Singa Discovery Station and
 * Singa Business Pro venues. Pending requests are deliberately not guessed:
 * Singa adds them to queue_size/queue_duration only after the host accepts
 * them (or Auto Accept does so).
 */
export function parseLegacySingaPublicStagePayload(
  payload: unknown,
  expectedVenueResourceId: string,
  expectedQueueResourceId: string,
  checkedAt: string,
): SingaPublicStageFreshWait | null {
  if (
    !isValidSingaVenueId(expectedVenueResourceId) ||
    !isValidSingaQueueId(expectedQueueResourceId) ||
    !isRecord(payload) ||
    payload.id !== DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_VENUE_ID ||
    payload.resource_id !== expectedVenueResourceId ||
    !Array.isArray(payload.queues)
  ) {
    return null;
  }

  const matchingQueues = payload.queues.filter(
    (value) =>
      isRecord(value) &&
      value.id === DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_QUEUE_ID &&
      value.resource_id === expectedQueueResourceId,
  );
  if (matchingQueues.length !== 1) return null;

  const queue = matchingQueues[0];
  if (queue.accepts_requests === false) {
    return {
      status: "inactive",
      waitMinutes: null,
      stale: false,
      checkedAt,
      dataUpdatedAt: checkedAt,
    };
  }
  if (
    queue.accepts_requests !== true ||
    !Number.isSafeInteger(queue.queue_size) ||
    (queue.queue_size as number) < 0 ||
    typeof queue.queue_duration !== "number" ||
    !Number.isFinite(queue.queue_duration) ||
    queue.queue_duration < 0
  ) {
    return null;
  }

  const waitMinutes = Math.ceil(queue.queue_duration);
  if (!Number.isSafeInteger(waitMinutes)) return null;
  return {
    status: "active",
    waitMinutes,
    stale: false,
    checkedAt,
    dataUpdatedAt: checkedAt,
  };
}

/**
 * Validate only the fields needed for the public wait display. Singa also
 * returns a public join code, but this parser intentionally never reads or
 * retains it.
 */
export function parseSingaPublicStagePayload(
  payload: unknown,
  expectedZoneId: string,
  expectedVenueId: string,
  checkedAt: string,
): SingaPublicStageFreshWait | null {
  if (
    !isValidSingaZoneId(expectedZoneId) ||
    !isValidSingaVenueId(expectedVenueId) ||
    !isRecord(payload)
  ) {
    return null;
  }
  if (payload.id !== expectedZoneId) return null;
  if (payload.venue_id !== expectedVenueId) return null;

  if (payload.session === null) {
    return {
      status: "inactive",
      waitMinutes: null,
      stale: false,
      checkedAt,
      dataUpdatedAt: checkedAt,
    };
  }

  if (!isRecord(payload.session)) return null;
  const waitMinutes = payload.session.queue_length;
  if (!Number.isSafeInteger(waitMinutes) || (waitMinutes as number) < 0) {
    return null;
  }

  return {
    status: "active",
    waitMinutes: waitMinutes as number,
    stale: false,
    checkedAt,
    dataUpdatedAt: checkedAt,
  };
}

/** Validate the deliberately narrow response from the server-only relay. */
export function parseSingaPublicStageRelayPayload(
  payload: unknown,
  receivedAt: string,
): SingaPublicStageFreshWait | null {
  if (!isRecord(payload) || typeof payload.checkedAt !== "string") return null;

  const receivedAtMs = Date.parse(receivedAt);
  const dataUpdatedAtMs = Date.parse(payload.checkedAt);
  const ageMs = receivedAtMs - dataUpdatedAtMs;
  if (
    !Number.isFinite(receivedAtMs) ||
    !Number.isFinite(dataUpdatedAtMs) ||
    ageMs < -5_000 ||
    ageMs > SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS
  ) {
    return null;
  }

  if (payload.status === "inactive" && payload.waitMinutes === null) {
    return {
      status: "inactive",
      waitMinutes: null,
      stale: false,
      checkedAt: receivedAt,
      dataUpdatedAt: payload.checkedAt,
    };
  }

  if (
    payload.status === "active" &&
    Number.isSafeInteger(payload.waitMinutes) &&
    (payload.waitMinutes as number) >= 0
  ) {
    return {
      status: "active",
      waitMinutes: payload.waitMinutes as number,
      stale: false,
      checkedAt: receivedAt,
      dataUpdatedAt: payload.checkedAt,
    };
  }

  return null;
}

export function unavailableSingaPublicStageWait(
  checkedAt: string,
  lastKnown: SingaPublicStageFreshWait | null,
): SingaPublicStageUnavailableWait {
  const checkedAtMs = Date.parse(checkedAt);
  const dataUpdatedAtMs = lastKnown
    ? Date.parse(lastKnown.dataUpdatedAt)
    : Number.NaN;
  const lastKnownAgeMs = checkedAtMs - dataUpdatedAtMs;
  const lastKnownIsFreshEnough =
    Number.isFinite(checkedAtMs) &&
    Number.isFinite(dataUpdatedAtMs) &&
    lastKnownAgeMs >= 0 &&
    lastKnownAgeMs <= SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS;
  const safeLastKnown = lastKnown && lastKnownIsFreshEnough
    ? {
        status: lastKnown.status,
        waitMinutes: lastKnown.waitMinutes,
        dataUpdatedAt: lastKnown.dataUpdatedAt,
      }
    : null;

  return {
    status: "unavailable",
    // Never put a last-known wait in the current-value field. Consumers must
    // opt into lastKnown and present it explicitly as stale.
    waitMinutes: null,
    stale: safeLastKnown !== null,
    checkedAt,
    dataUpdatedAt: safeLastKnown?.dataUpdatedAt ?? null,
    lastKnown: safeLastKnown,
  };
}
