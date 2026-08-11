import { NextResponse } from "next/server";
import { getBowlingLaneSnapshot } from "@/lib/bowling-lanes";
import { getStoredDartseeLaneSnapshot } from "@/lib/dartsee-lanes";
import { getStorageStatus } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type VersionMetadata = { id?: string };

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
  const [storage, bowling, darts] = await Promise.all([
    getStorageStatus().catch(() => ({ backend: "none" as const, canWrite: false })),
    getBowlingLaneSnapshot().catch(() => null),
    getStoredDartseeLaneSnapshot().catch(() => null),
  ]);

  const storageStatus = storage.canWrite ? "ok" : "unavailable";
  const bowlingStatus = bowling
    ? bowling.healthStatus === "ok" ? "ok" : "degraded"
    : "unavailable";
  const dartsStatus = darts
    ? darts.healthStatus === "ok" ? "ok" : "degraded"
    : "unavailable";
  const status = storageStatus === "ok" && bowlingStatus !== "unavailable" && dartsStatus !== "unavailable"
    ? bowlingStatus === "ok" && dartsStatus === "ok" ? "ok" : "degraded"
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
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
