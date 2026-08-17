import profanity from "leo-profanity";

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const NAME_CHARACTERS = /^[\p{L}\p{M} .'’-]+$/u;
const HAS_LETTER = /\p{L}/u;
const COMBINING_MARK = /\p{M}/gu;
const NON_ASCII_LETTER = /[^a-z]/g;

// Some dictionary entries are also established real names. Keep the public
// rule conservative here; obvious compounds such as "dickhead" are still
// caught by the high-confidence fragment list below.
const LEGITIMATE_EXACT_NAME_ALLOWLIST = new Set(["dick"]);

// Exact dictionary matching avoids substring mistakes in legitimate names.
// These unambiguous fragments additionally catch compounds and separators
// intended only to evade the exact-word check.
const HIGH_CONFIDENCE_FRAGMENTS = [
  "asshole",
  "bitch",
  "cocksucker",
  "cunt",
  "dickhead",
  "faggot",
  "fuck",
  "motherfucker",
  "nigger",
  "pussy",
  "shit",
  "slut",
  "whore",
] as const;

const LEET_EQUIVALENTS: Record<string, string> = {
  "0": "o",
  "1": "i",
  "2": "z",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  "$": "s",
  "!": "i",
};

function canonicalizePart(value: string): string | null {
  if (CONTROL_OR_FORMAT.test(value)) return null;

  const canonical = value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc\uff07]/g, "'")
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!canonical || canonical.length > 40) return null;
  if (!HAS_LETTER.test(canonical) || !NAME_CHARACTERS.test(canonical)) {
    return null;
  }
  if (/^[.'-]/.test(canonical) || /['-]$/.test(canonical) || /[.'-]{3,}/.test(canonical)) {
    return null;
  }
  return canonical;
}

function hasMixedLookalikeScripts(value: string): boolean {
  return value.split(/[ .'’-]+/u).some((token) => {
    if (!token) return false;
    const hasLatin = /\p{Script=Latin}/u.test(token);
    const hasCyrillic = /\p{Script=Cyrillic}/u.test(token);
    const hasGreek = /\p{Script=Greek}/u.test(token);
    return Number(hasLatin) + Number(hasCyrillic) + Number(hasGreek) > 1;
  });
}

function foldForSafety(value: string): string {
  return Array.from(
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(COMBINING_MARK, ""),
  )
    .map((character) => LEET_EQUIVALENTS[character] ?? character)
    .join("")
    .replace(NON_ASCII_LETTER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseRepeatedLetters(value: string): string {
  return value.replace(/([a-z])\1+/g, "$1");
}

function dictionaryKey(value: string): string {
  return foldForSafety(value).replace(/ /g, "");
}

const BLOCKED_EXACT = new Set(
  profanity
    .list()
    .map(dictionaryKey)
    .filter(Boolean)
    .filter((word) => !LEGITIMATE_EXACT_NAME_ALLOWLIST.has(word)),
);

function containsInappropriateLanguage(value: string): boolean {
  const folded = foldForSafety(value);
  if (!folded) return false;

  const tokens = folded.split(" ").filter(Boolean);
  const compact = tokens.join("");
  const candidates = new Set([
    ...tokens,
    ...tokens.map(collapseRepeatedLetters),
    compact,
    collapseRepeatedLetters(compact),
  ]);

  for (const candidate of candidates) {
    if (
      BLOCKED_EXACT.has(candidate) &&
      !LEGITIMATE_EXACT_NAME_ALLOWLIST.has(candidate)
    ) {
      return true;
    }
  }

  const collapsedCompact = collapseRepeatedLetters(compact);
  return HIGH_CONFIDENCE_FRAGMENTS.some(
    (fragment) => compact.includes(fragment) || collapsedCompact.includes(fragment),
  );
}

export type PublicGuestNameResult =
  | { ok: true; firstName: string; lastName: string; fullName: string }
  | { ok: false };

export function validatePublicGuestName(
  firstNameInput: string,
  lastNameInput: string,
): PublicGuestNameResult {
  const firstName = canonicalizePart(firstNameInput);
  const lastName = canonicalizePart(lastNameInput);
  if (!firstName || !lastName) return { ok: false };

  const fullName = `${firstName} ${lastName}`;
  if (
    hasMixedLookalikeScripts(firstName) ||
    hasMixedLookalikeScripts(lastName) ||
    containsInappropriateLanguage(fullName)
  ) {
    return { ok: false };
  }

  return { ok: true, firstName, lastName, fullName };
}
