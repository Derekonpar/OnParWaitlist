import { readEnv } from "./env";
import {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_QUEUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  parseLegacySingaPublicStagePayload,
  parseSingaPublicStageRelayPayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

export {
  DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_VENUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_QUEUE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_ZONE_ID,
  DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL,
  SINGA_PUBLIC_STAGE_CACHE_MS,
  SINGA_PUBLIC_STAGE_LAST_KNOWN_MAX_AGE_MS,
  SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  isValidSingaVenueId,
  isValidSingaZoneId,
  parseLegacySingaPublicStagePayload,
  parseSingaPublicStagePayload,
  parseSingaPublicStageRelayPayload,
  unavailableSingaPublicStageWait,
  type SingaPublicStageFreshWait,
  type SingaPublicStageLastKnown,
  type SingaPublicStageUnavailableWait,
  type SingaPublicStageWait,
} from "./singa-public-stage-contract";

const SINGA_PUBLIC_VENUE_URL = "https://api.singa.com/v1.4/venues";

let responseCache:
  | { value: SingaPublicStageWait; expiresAt: number }
  | null = null;
let lastKnownGood: SingaPublicStageFreshWait | null = null;
let refreshInFlight: Promise<SingaPublicStageWait> | null = null;
let transportDiagnostic = {
  transport: "not-checked" as "not-checked" | "direct" | "relay",
  outcome: "not-checked" as
    | "not-checked"
    | "invalid-config"
    | "upstream-http"
    | "invalid-payload"
    | "request-failed"
    | "ok",
};

function configuredVenueId(): string {
  return (
    readEnv("SINGA_PUBLIC_STAGE_VENUE_ID") ??
    DEFAULT_SINGA_PUBLIC_STAGE_VENUE_ID
  ).trim();
}

function configuredRelayToken(): string | null {
  const value = readEnv("SINGA_PUBLIC_STAGE_RELAY_TOKEN")?.trim() ?? "";
  return value.length > 0 ? value : null;
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

function singaPublicStageRequest(
  requestContext: Request,
): Request {
  // Cloudflare can reject a cross-zone subrequest when it is created without
  // the incoming request context. Clone only that routing context, then remove
  // every browser-supplied header before the request leaves On Par.
  const request = new Request(
    `${SINGA_PUBLIC_VENUE_URL}/${DEFAULT_SINGA_PUBLIC_STAGE_LEGACY_VENUE_ID}/`,
    requestContext as unknown as RequestInit,
  );
  const inheritedHeaderNames: string[] = [];
  request.headers.forEach((_value, name) => inheritedHeaderNames.push(name));
  for (const name of inheritedHeaderNames) request.headers.delete(name);
  request.headers.set("accept", "application/json");
  request.headers.set("cache-control", "no-cache");
  request.headers.set("user-agent", "OnPar-Waitlist/1.0");
  // Wrangler remote preview adds this header automatically. Other Cloudflare
  // zones reject it, and production never needs it.
  request.headers.delete("cf-workers-preview-token");
  return request;
}

async function refreshSingaPublicStageWait(
  requestContext: Request,
): Promise<SingaPublicStageWait> {
  const venueId = configuredVenueId();
  if (!isValidSingaVenueId(venueId)) {
    transportDiagnostic = {
      transport: "not-checked",
      outcome: "invalid-config",
    };
    return remember(unavailableNow());
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SINGA_PUBLIC_STAGE_TIMEOUT_MS,
  );

  try {
    const relayToken = configuredRelayToken();
    transportDiagnostic = {
      transport: relayToken ? "relay" : "direct",
      outcome: "not-checked",
    };
    const response = relayToken
      ? await fetch(DEFAULT_SINGA_PUBLIC_STAGE_RELAY_URL, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${relayToken}`,
          },
          signal: controller.signal,
        })
      : await fetch(singaPublicStageRequest(requestContext), {
          signal: controller.signal,
        });
    if (!response.ok) {
      transportDiagnostic.outcome = "upstream-http";
      return remember(unavailableNow());
    }

    const checkedAt = new Date().toISOString();
    const payload = (await response.json()) as unknown;
    const fresh = relayToken
      ? parseSingaPublicStageRelayPayload(payload, checkedAt)
      : parseLegacySingaPublicStagePayload(
          payload,
          venueId,
          DEFAULT_SINGA_PUBLIC_STAGE_QUEUE_ID,
          checkedAt,
        );
    if (!fresh) {
      transportDiagnostic.outcome = "invalid-payload";
      return remember(unavailableNow());
    }

    transportDiagnostic.outcome = "ok";
    lastKnownGood = fresh;
    return remember(fresh);
  } catch {
    transportDiagnostic.outcome = "request-failed";
    return remember(unavailableNow());
  } finally {
    clearTimeout(timeout);
  }
}

/** Sanitized transport state for response headers and operations monitoring. */
export function getSingaPublicStageTransportDiagnostic() {
  return { ...transportDiagnostic };
}

/**
 * Read the accepted Public Stage queue published for the Singa Discovery
 * Station/Business Pro venue. This server-side call never authenticates to a
 * guest or staff Singa account, never mutates Singa, and never exposes or logs
 * upstream response details. Production uses a fixed, token-protected relay;
 * local development can read the same public venue endpoint directly.
 */
export async function getSingaPublicStageWait(
  requestContext: Request,
): Promise<SingaPublicStageWait> {
  const nowMs = Date.now();
  if (responseCache && nowMs < responseCache.expiresAt) {
    return responseCache.value;
  }
  if (refreshInFlight) return refreshInFlight;

  const refresh = refreshSingaPublicStageWait(requestContext);
  refreshInFlight = refresh;
  try {
    return await refresh;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = null;
  }
}
