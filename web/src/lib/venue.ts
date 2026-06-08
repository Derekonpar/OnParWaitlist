export function getVenueName(): string {
  return process.env.VENUE_NAME ?? "On Par Entertainment";
}

export function getVenuePhone(): string {
  return process.env.VENUE_PHONE ?? "937-705-6024";
}

export function getVenuePhoneTel(): string {
  const digits = getVenuePhone().replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function getContactEmail(): string {
  return process.env.CONTACT_EMAIL ?? "info@onparbar.com";
}

export function getPublicAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://on-par-waitlist.vercel.app"
  ).replace(/\/$/, "");
}
