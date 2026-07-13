import { readEnv } from "./env";

/** Public site URL for SMS links and shareable status pages. */
export function getAppBaseUrl(): string {
  const configured = readEnv("NEXT_PUBLIC_APP_URL")?.replace(/\/$/, "");
  if (configured) return configured;
  const vercelUrl = readEnv("VERCEL_URL");
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  return "https://onparwaitlist.com";
}

export function statusPageUrl(entryId: string): string {
  return `${getAppBaseUrl()}/status/${entryId}`;
}
