import { readEnv } from "./env";
import {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseSingaPublicStagePayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

export {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseSingaPublicStagePayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageLastKnown,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

const SINGA_PUBLIC_ZONE_URL =
  "https://business-api.singa.com/v1/public/zones";

let responseCache:
  | { value: SingaPublicStageWait; expiresAt: number }
  | null = null;
let lastKnownGood: SingaPublicStageFreshWait | null = null;
let refreshInFlight: Promise<SingaPublicStageWait> | null = null;

function configuredZoneId(): string {
  return (
    readEnv("SINGA_PUBLIC_STAGE_ZONE_ID") ??
    DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID
  ).trim();
}

function configuredVenueId(): string {
  return (
    readEnv("SINGA_PUBLIC_STAGE_VENUE_ID") ??
    DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID
  ).trim();
}

function remember(value: SingaPublicStageWait): SingaPublicStageWait {
  const nowMs = Date.now();
  let expiresAt = nowMs + SINGA_PUBLIC_STAGE_CACHE_MS;
  if (value.status === "unavailable" && value.dataUpdatedAt) {
    const lastKnownExpiresAt =
      Date.parse(value.dataUpdatedAt) +
      SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS;
    if (Number.isFinite(lastKnownExpiresAt)) {
      expiresAt = Math.min(expiresAt, lastKnownExpiresAt);
    }
  }
  responseCache = {
    value,
    expiresAt,
  };
  return value;
}

function unavailableNow(): SingaPublicStageUnavailableWait {
  const value = unavailableSingaPublicStageWait(
    new Date().toISOString(),
    lastKnownGood,
  );
  if (!value.lastKnown) lastKnownGood = null;
  return value;
}

async function refreshSingaPublicStageWait(): Promise<SingaPublicStageWait> {
  const zoneId = configuredZoneId();
  const venueId = configuredVenueId();
  if (!isValidSingaZoneId(zoneId) || !isValidSingaVenueId(venueId)) {
    return remember(unavailableNow());
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `${SINGA_PUBLIC_ZONE_URL}/${encodeURIComponent(zoneId)}`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response.ok) return remember(unavailableNow());

    const checkedAt = new Date().toISOString();
    const fresh = parseSingaPublicStagePayload(
      (await response.json()) as unknown,
      zoneId,
      venueId,
      checkedAt,
    );
    if (!fresh) return remember(unavailableNow());

    lastKnownGood = fresh;
    return remember(fresh);
  } catch {
    return remember(unavailableNow());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read the public Singa stage wait. This server-side call never authenticates,
 * never mutates Singa, and never exposes or logs upstream response details.
 */
export async function getSingaPublicStageWait(): Promise<SingaPublicStageWait> {
  const nowMs = Date.now();
  if (responseCache && nowMs < responseCache.expiresAt) {
    return responseCache.value;
  }
  if (refreshInFlight) return refreshInFlight;

  const refresh = refreshSingaPublicStageWait();
  refreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = null;
  }
}
