import { NextResponse } from "next/server";
import { getBowlingLaneSnapshot } from "@/lib/bowling-lanes";
import { getStoredDartseeLaneSnapshot } from "@/lib/dartsee-lanes";
import { getStoredEntertainmentSchedule } from "@/lib/entertainment-schedule";
import { getStorageStatus } from "@/lib/store";
import { withDeadline } from "@/lib/async-deadline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VersionMetadata = { id?: string };
type DependencyStatus = "ok" | "degraded" | "unavailable";

const HEALTH_READ_TIMEOUT_MS = 2_000;
const BOWLING_FRESH_FOR_MS = 120_000;
const DARTSEE_FRESH_FOR_MS = 60_000;
const SCHEDULE_FRESH_FOR_MS = 120_000;

function isFresh(value: string | undefined, maxAgeMs: number, nowMs: number) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && nowMs - timestamp <= maxAgeMs;
}

function buildIdentifier() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const metadata = getCloudflareContext()?.env
      ?.CF_VERSION_METADATA as VersionMetadata | undefined;
    return metadata?.id ?? "local";
  } catch {
    return "local";
  }
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const nowMs = Date.now();
  const [storage, bowling, darts, schedule] = await Promise.all([
    withDeadline(
      getStorageStatus().catch(() => ({
        backend: "none" as const,
        canWrite: false,
      })),
      HEALTH_READ_TIMEOUT_MS,
      { backend: "none" as const, canWrite: false },
    ),
    withDeadline(
      getBowlingLaneSnapshot().catch(() => null),
      HEALTH_READ_TIMEOUT_MS,
      null,
    ),
    withDeadline(
      getStoredDartseeLaneSnapshot().catch(() => null),
      HEALTH_READ_TIMEOUT_MS,
      null,
    ),
    withDeadline(
      getStoredEntertainmentSchedule().catch(() => null),
      HEALTH_READ_TIMEOUT_MS,
      null,
    ),
  ]);

  const storageStatus: DependencyStatus = storage.canWrite
    ? "ok"
    : "unavailable";
  const bowlingStatus: DependencyStatus = !bowling
    ? "unavailable"
    : bowling.healthStatus === "ok" &&
        isFresh(bowling.capturedAt, BOWLING_FRESH_FOR_MS, nowMs)
      ? "ok"
      : "degraded";
  const dartsStatus: DependencyStatus = !darts
    ? "unavailable"
    : darts.healthStatus === "ok" &&
        isFresh(darts.capturedAt, DARTSEE_FRESH_FOR_MS, nowMs)
      ? "ok"
      : "degraded";
  const scheduleStatus: DependencyStatus = !schedule
    ? "unavailable"
    : isFresh(schedule.fetchedAt, SCHEDULE_FRESH_FOR_MS, nowMs)
      ? "ok"
      : "degraded";
  const dependencyStatuses = [
    storageStatus,
    bowlingStatus,
    dartsStatus,
    scheduleStatus,
  ];
  const status = dependencyStatuses.every((value) => value === "ok")
    ? "ok"
    : "degraded";

  return NextResponse.json(
    {
      service: "onpar-waitlist",
      status,
      version: { app: "0.1.0", build: buildIdentifier() },
      checkedAt,
      dependencies: {
        storage: { status: storageStatus, backend: storage.backend },
        bowlingFeed: {
          status: bowlingStatus,
          capturedAt: bowling?.capturedAt ?? null,
          receivedAt: bowling?.receivedAt ?? null,
          healthUpdatedAt: bowling?.healthUpdatedAt ?? null,
        },
        dartseeFeed: {
          status: dartsStatus,
          capturedAt: darts?.capturedAt ?? null,
          receivedAt: darts?.receivedAt ?? null,
          healthUpdatedAt: darts?.healthUpdatedAt ?? null,
        },
        entertainmentSchedule: {
          status: scheduleStatus,
          fetchedAt: schedule?.fetchedAt ?? null,
        },
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
