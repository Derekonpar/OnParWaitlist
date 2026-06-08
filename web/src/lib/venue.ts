export function getVenueName(): string {
  return process.env.VENUE_NAME ?? "On Par Entertainment";
}

export function getVenuePhone(): string {
  return process.env.VENUE_PHONE ?? "";
}

export function getContactEmail(): string {
  return process.env.CONTACT_EMAIL ?? "";
}

export function getPublicAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  ).replace(/\/$/, "");
}
