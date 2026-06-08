/** Public-facing name: "Jordan Smith" → "Jordan S." */
export function displayName(fullName: string | null | undefined): string {
  if (!fullName?.trim()) return "Guest";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return lastInitial ? `${first} ${lastInitial}.` : first;
}
