import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const tvSchema = z.object({
  id: z.string().regex(/^[a-z\d-]+$/i),
  name: z.string().min(1).max(80),
  configured: z.boolean(),
  online: z.boolean(),
  awake: z.boolean(),
  checkedAt: z.string().datetime().nullable(),
  sourceId: z.string().nullable(),
  url: z.string().url().nullable(),
});

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z\d-]+$/i),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const stateSchema = z.object({
  checkedAt: z.string().datetime(),
  tvs: z.array(tvSchema).max(40),
  sources: z.array(sourceSchema).max(40),
});

const commandSchema = z
  .object({
    tvId: z.string().regex(/^[a-z\d-]+$/i),
    sourceId: z.string().regex(/^[a-z\d-]+$/i).optional(),
    url: z.string().trim().max(2048).optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.sourceId) === Boolean(value.url)) {
      context.addIssue({ code: "custom", message: "Choose one website." });
      return;
    }
    if (value.url) {
      try {
        const parsed = new URL(value.url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      } catch {
        context.addIssue({ code: "custom", path: ["url"], message: "Enter a valid website." });
      }
    }
  });

function config() {
  const origin = readEnv("TV_HUB_ORIGIN_URL")?.replace(/\/$/, "");
  const token = readEnv("TV_HUB_RELAY_TOKEN");
  if (!origin || !token) throw new Error("TV Hub is not configured.");
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("TV Hub origin is invalid.");
  return { origin: parsed.toString().replace(/\/$/, ""), token };
}

async function relay(path: string, init?: RequestInit) {
  const { origin, token } = config();
  return fetch(`${origin}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(35_000),
  });
}

function unavailable() {
  return NextResponse.json(
    { error: "TV Hub is temporarily unavailable. The local Mac may be offline." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const response = await relay("/api/relay/state");
    if (!response.ok) return unavailable();
    const parsed = stateSchema.safeParse(await response.json());
    if (!parsed.success) return unavailable();
    return NextResponse.json(parsed.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[tvhub state]", error instanceof Error ? error.message : "unknown error");
    return unavailable();
  }
}

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const command = commandSchema.safeParse(await request.json());
    if (!command.success) {
      return NextResponse.json({ error: "Choose one TV and one valid website." }, { status: 400 });
    }
    const response = await relay("/api/relay/show", {
      method: "POST",
      body: JSON.stringify(command.data),
    });
    const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown; state?: unknown } | null;
    if (!response.ok) {
      const message = typeof body?.error === "string" && body.error.length <= 220
        ? body.error
        : "The TV Hub could not complete that command.";
      return NextResponse.json({ error: message }, { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
    }
    const state = stateSchema.safeParse(body?.state);
    if (!state.success || typeof body?.message !== "string") return unavailable();
    return NextResponse.json({ message: body.message, state: state.data }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("[tvhub command]", error instanceof Error ? error.message : "unknown error");
    return unavailable();
  }
}
