/** Public site URL for SMS links and shareable status pages. */
export function getAppBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://on-par-waitlist.vercel.app";
}

export function statusPageUrl(entryId: string): string {
  return `${getAppBaseUrl()}/status/${entryId}`;
}
