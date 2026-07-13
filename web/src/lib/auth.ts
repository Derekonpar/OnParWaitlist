import { readEnv } from "./env";

export function verifyStaffSecret(request: Request): boolean {
  const secret = readEnv("STAFF_SECRET");
  if (!secret) return false;
  const header = request.headers.get("x-staff-secret");
  const url = new URL(request.url);
  const query = url.searchParams.get("secret");
  return header === secret || query === secret;
}
