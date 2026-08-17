import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyStaffSecret } from "@/lib/auth";
import { archiveEntry, getStaffArchivePage } from "@/lib/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid(),
});

const searchSchema = z.object({
  q: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});

export async function GET(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const parsed = searchSchema.safeParse({
    q: params.get("q") ?? "",
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid archive search" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const result = await getStaffArchivePage({
      query: parsed.data.q,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (err) {
    console.error("[archive search]", err);
    return NextResponse.json(
      { error: "Archive search failed" },
      { status: 500, headers: { "cache-control": "private, no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!verifyStaffSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const entry = await archiveEntry(parsed.data.id);
    if (!entry) {
      return NextResponse.json(
        { error: "Only served or removed guests can be deleted to archive" },
        { status: 400 },
      );
    }

    return NextResponse.json({ entry });
  } catch (err) {
    console.error("[archive]", err);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}
