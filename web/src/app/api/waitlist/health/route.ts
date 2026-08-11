import { GET as healthGET } from "@/app/api/health/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = healthGET;
