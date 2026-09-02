const WINDOWS_WEEKDAY =
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i;
const WINDOWS_MONTH =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const REMOTE_DESKTOP_SESSION_URL =
  /\bremotedesktop\.google\.com\/access\/session(?:\/|\b)/i;

export function observationText(observations) {
  return observations.map((obs) => String(obs.text ?? "")).join("\n");
}

export function findObservation(observations, patterns) {
  return observations.find((obs) =>
    patterns.some((pattern) => pattern.test(String(obs.text ?? ""))),
  );
}

function isLargeWindowsLockClock(observation) {
  const text = String(observation.text ?? "").trim();
  const height = Number(observation.height);
  const y = Number(observation.y);
  return (
    /^(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d$/.test(text) &&
    Number.isFinite(height) &&
    height >= 0.045 &&
    Number.isFinite(y) &&
    y < 0.45
  );
}

export function detectScreenState(
  observations,
  {
    nowMs = Date.now(),
    windowsBootExpectedUntil = 0,
    deskLaunchExpectedUntil = 0,
  } = {},
) {
  const text = observationText(observations);
  const laneLabels = observations.filter((obs) =>
    /\bLane\s*\d{1,2}\b/i.test(String(obs.text ?? "")),
  );

  // A visible live feed always wins. Brunswick lane timers can resemble the
  // large Windows clock, and browser chrome can retain the Remote Desktop URL.
  if (/\bBowling\b/i.test(text) && laneLabels.length >= 2) return "feed";

  const exactLockShortcut =
    /ctrl\s*\+?\s*alt\s*\+?\s*delete|ctrl\s*-\s*alt\s*-\s*del/i.test(text);
  const lockPrompt = observations.some((obs) => {
    const candidate = String(obs.text ?? "");
    // Vision sometimes compresses and substitutes nearly every character in
    // "Ctrl+Alt+Delete" while retaining the surrounding instruction.
    return /\bpress\b/i.test(candidate) && /\bunlock\b/i.test(candidate);
  });
  const promptOmittedLockScreen =
    REMOTE_DESKTOP_SESSION_URL.test(text) &&
    observations.some(isLargeWindowsLockClock) &&
    WINDOWS_WEEKDAY.test(text) &&
    WINDOWS_MONTH.test(text);
  if (exactLockShortcut || lockPrompt || promptOmittedLockScreen) {
    return "windows-lock";
  }

  if (/\bOwner\b/i.test(text) && /password|sign\s*in/i.test(text)) {
    return "windows-owner-login";
  }
  if (/\bOwner\b/i.test(text)) return "windows-owner-select";
  if (/welcome|please wait|preparing windows|just a moment|getting windows ready/i.test(text)) {
    return "windows-booting";
  }
  const userAndPasswordFieldsVisible =
    Boolean(findObservation(observations, [/^User$/i])) &&
    Boolean(findObservation(observations, [/password/i]));
  const deskLoginVisible =
    /desk\s*login/i.test(text) ||
    (nowMs < deskLaunchExpectedUntil && userAndPasswordFieldsVisible);
  if (
    /password/i.test(text) &&
    ((/user\s*name|username/i.test(text) && /log\s*in|sign\s*in/i.test(text)) ||
      (deskLoginVisible && /^User$/im.test(text)))
  ) {
    return "brunswick-login";
  }
  // Windows can restore Brunswick Office after a reboot. That is not the
  // Desk lane view, and its similar User/Password form must never receive the
  // Desk credentials. Return to the desktop so recovery can launch Desk.
  if (
    /office\s*login/i.test(text) ||
    (/syncserver/i.test(text) && /system analysis/i.test(text) && /nightly tasks/i.test(text))
  ) {
    return "brunswick-office";
  }
  if (/host is offline|computer is offline|unable to connect|can(?:not|'t) connect|not available|turned off/i.test(text)) {
    return "remote-offline";
  }
  // Chrome Remote Desktop's connected-session PIN screen often contains only
  // "Enter PIN" plus a remotedesktop.google.com URL. Do not require the
  // spaced words "Remote Desktop" or the BrunswickHQ card beneath it wins.
  if (/enter\s*(?:access\s*)?(?:code|pin)|remember my pin|\bpin\b/i.test(text)) {
    return "remote-code";
  }
  if (findObservation(observations, [/^Desk$/i])) return "remote-desktop";
  const windowsDesktopVisible =
    REMOTE_DESKTOP_SESSION_URL.test(text) &&
    /Recycle\s*Bin/i.test(text) &&
    /\bOffice\b/i.test(text) &&
    (/Brunswick\s+(?:Remote|Kemote)/i.test(text) || /BLS-2023/i.test(text));
  if (windowsDesktopVisible) return "remote-desktop";
  // The connected Chrome tab is also titled BrunswickHQ. Only text inside the
  // Remote Access page body is a selectable host; ignore the browser chrome.
  if (
    observations.some(
      (obs) => /Brunswick\s*HQ/i.test(String(obs.text ?? "")) && Number(obs.y) < 0.9,
    )
  ) return "remote-host-list";
  if (nowMs < windowsBootExpectedUntil) return "windows-booting";
  if (nowMs < deskLaunchExpectedUntil) return "desk-starting";
  return "unknown";
}
