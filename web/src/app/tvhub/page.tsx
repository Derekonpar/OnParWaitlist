"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tvhub.module.css";

type Tv = {
  id: string;
  name: string;
  configured: boolean;
  online: boolean;
  awake: boolean;
  checkedAt: string | null;
  sourceId: string | null;
  url: string | null;
};

type Source = { id: string; name: string; url: string };
type HubState = {
  checkedAt: string;
  tvs: Tv[];
  sources: Source[];
  triviaMode: { active: boolean; participantIds: string[] };
};

const secretKey = "onpar-staff-secret";

function tvNumber(name: string) {
  return Number(name.match(/\d+/)?.[0] || 999);
}

function siteName(tv: Tv, sources: Source[]) {
  const saved = sources.find((source) => source.id === tv.sourceId || source.url === tv.url);
  if (saved) return saved.name;
  if (!tv.url) return "No website assigned";
  try { return new URL(tv.url).hostname.replace(/^www\./, ""); }
  catch { return "Custom website"; }
}

function currentSiteName(url: string) {
  try {
    const parsed = new URL(url);
    const detail = [...parsed.pathname.split("/"), ...parsed.hash.split("/")]
      .filter(Boolean)
      .at(-1);
    const host = parsed.hostname.replace(/^www\./, "");
    return detail ? `${host} — ${decodeURIComponent(detail)}` : host;
  } catch {
    return "Custom website";
  }
}

function sortedHub(state: HubState): HubState {
  return {
    ...state,
    tvs: [...state.tvs].sort((a, b) => tvNumber(a.name) - tvNumber(b.name)),
  };
}

export default function TvHubPage() {
  const [secret, setSecret] = useState("");
  const [pin, setPin] = useState("");
  const [hub, setHub] = useState<HubState | null>(null);
  const [selectedTvIds, setSelectedTvIds] = useState<string[]>([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (staffSecret: string, quiet = false) => {
    if (!staffSecret) return false;
    if (!quiet) setBusy(true);
    try {
      const response = await fetch("/api/staff/tvhub", {
        cache: "no-store",
        headers: { "x-staff-secret": staffSecret },
      });
      if (response.status === 401) {
        sessionStorage.removeItem(secretKey);
        setSecret("");
        setHub(null);
        if (!quiet) setError("Enter the staff PIN to open TV Hub.");
        return false;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "TV Hub is unavailable.");
      const sorted = sortedHub(body as HubState);
      setHub(sorted);
      setSelectedTvIds((current) => {
        const available = new Set(sorted.tvs.filter((tv) => tv.configured).map((tv) => tv.id));
        const retained = current.filter((id) => available.has(id));
        if (retained.length) return retained;
        const first = sorted.tvs.find((tv) => tv.configured);
        return first ? [first.id] : [];
      });
      if (!quiet) setError("");
      return true;
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "TV Hub is unavailable.");
      return false;
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(secretKey) || "";
    if (!saved) return;
    const timer = window.setTimeout(() => {
      setSecret(saved);
      setPin(saved);
      void load(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setInterval(() => void load(secret, true), 30_000);
    return () => window.clearInterval(timer);
  }, [load, secret]);

  const siteOptions = useMemo(() => {
    if (!hub) return [];
    const known = new Set(hub.sources.map((source) => source.url));
    const active = hub.tvs
      .filter((tv) => tv.url && !known.has(tv.url))
      .map((tv) => ({
        value: `url:${tv.url}`,
        label: `Currently showing — ${currentSiteName(tv.url!)}`,
        url: tv.url!,
      }));
    return [
      ...hub.sources.map((source) => ({ value: `source:${source.id}`, label: source.name, url: source.url })),
      ...Array.from(new Map(active.map((option) => [option.url, option])).values()),
    ];
  }, [hub]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const clean = pin.replace(/\D/g, "").slice(0, 4);
    if (clean.length !== 4) return setError("Enter the 4-digit staff PIN.");
    if (await load(clean)) {
      sessionStorage.setItem(secretKey, clean);
      setSecret(clean);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!selectedTvIds.length || !selectedSite) return setError("Choose one or more TVs and a website.");
    const payload: { action: "show"; tvIds: string[]; sourceId?: string; url?: string } = {
      action: "show",
      tvIds: selectedTvIds,
    };
    if (selectedSite === "custom") {
      const entered = customUrl.trim();
      if (!entered) return setError("Enter the custom website address.");
      payload.url = /^[a-z][a-z\d+.-]*:\/\//i.test(entered) ? entered : `https://${entered}`;
    } else if (selectedSite.startsWith("source:")) {
      payload.sourceId = selectedSite.slice(7);
    } else if (selectedSite.startsWith("url:")) {
      payload.url = selectedSite.slice(4);
    }
    setBusy(true);
    try {
      const response = await fetch("/api/staff/tvhub", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-secret": secret },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The website was not sent.");
      setHub(sortedHub(body.state as HubState));
      setMessage(body.message);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The website was not sent.");
    } finally {
      setBusy(false);
    }
  };

  const toggleTv = (tvId: string) => {
    setSelectedTvIds((current) =>
      current.includes(tvId)
        ? current.filter((id) => id !== tvId)
        : [...current, tvId],
    );
  };

  const changeTriviaMode = async () => {
    if (!hub) return;
    setBusy(true);
    setMessage("");
    setError("");
    const active = !hub.triviaMode.active;
    try {
      const response = await fetch("/api/staff/tvhub", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-secret": secret },
        body: JSON.stringify({ action: "trivia", active }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Trivia Mode could not be changed.");
      const next = sortedHub(body.state as HubState);
      setHub(next);
      if (active && next.triviaMode.participantIds.length) {
        setSelectedTvIds(next.triviaMode.participantIds);
      }
      setMessage(body.message);
    } catch (triviaError) {
      setError(triviaError instanceof Error ? triviaError.message : "Trivia Mode could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  if (!secret || !hub) {
    return (
      <main className={styles.loginShell}>
        <form className={styles.loginCard} onSubmit={login}>
          <div className={styles.eyebrow}>On Par staff</div>
          <h1>TV Hub</h1>
          <p>Enter the same PIN used for the staff dashboard.</p>
          <label>
            Staff PIN
            <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="current-password" placeholder="••••" autoFocus />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <button className={styles.primary} disabled={busy}>{busy ? "Connecting…" : "Open TV Hub"}</button>
        </form>
      </main>
    );
  }

  const configuredTvs = hub.tvs.filter((tv) => tv.configured);
  const selectedTvs = hub.tvs.filter((tv) => selectedTvIds.includes(tv.id));
  const selectionLabel = selectedTvs.length === 0
    ? "Choose TVs"
    : selectedTvs.length === 1
      ? selectedTvs[0].name
      : `${selectedTvs.length} TVs selected`;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>On Par staff controls</div>
          <h1>TV Hub</h1>
          <p>Choose one or more screens, choose a website, then send it.</p>
        </div>
        <button className={styles.secondary} onClick={() => void load(secret)} disabled={busy}>Refresh</button>
      </header>

      <section className={`${styles.triviaCard} ${hub.triviaMode.active ? styles.triviaActive : ""}`}>
        <div>
          <div className={styles.eyebrow}>Venue-wide shortcut</div>
          <h2>Trivia Mode</h2>
          <p>
            {hub.triviaMode.active
              ? `Live on ${hub.triviaMode.participantIds.length} TVs. Turning it off restores their previous websites.`
              : "Uses the same currently online TVs and restoration behavior as the local TV dashboard."}
          </p>
        </div>
        <button type="button" className={hub.triviaMode.active ? styles.triviaStop : styles.triviaStart} onClick={() => void changeTriviaMode()} disabled={busy}>
          {busy ? "Working…" : hub.triviaMode.active ? "Turn Trivia Mode Off" : "Start Trivia Mode"}
        </button>
      </section>

      <section className={styles.desktopGrid} aria-label="TV screens">
        {hub.tvs.map((tv) => (
          <button
            key={tv.id}
            type="button"
            aria-pressed={selectedTvIds.includes(tv.id)}
            disabled={!tv.configured}
            className={`${styles.tvCard} ${selectedTvIds.includes(tv.id) ? styles.selected : ""}`}
            onClick={() => toggleTv(tv.id)}
          >
            <span className={`${styles.statusDot} ${tv.online ? styles.online : styles.offline}`} />
            <strong>{tv.name}</strong>
            <span>{siteName(tv, hub.sources)}</span>
            <small>{tv.online ? "Online" : tv.configured ? "Offline" : "Not configured"}</small>
          </button>
        ))}
      </section>

      <form className={styles.controlCard} onSubmit={send}>
        <div className={styles.tvPicker}>
          <label>TV screens</label>
          <details className={styles.tvDropdown}>
            <summary>{selectionLabel}</summary>
            <div className={styles.tvDropdownPanel}>
              <div className={styles.selectionActions}>
                <button type="button" onClick={() => setSelectedTvIds(configuredTvs.map((tv) => tv.id))}>
                  Select all TVs
                </button>
                <button type="button" onClick={() => setSelectedTvIds(hub.tvs.filter((tv) => tv.online).map((tv) => tv.id))}>
                  Online only
                </button>
                <button type="button" onClick={() => setSelectedTvIds([])}>Clear</button>
              </div>
              <div className={styles.tvOptions}>
                {hub.tvs.map((tv) => (
                  <label key={tv.id} className={`${styles.tvOption} ${!tv.configured ? styles.tvOptionDisabled : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedTvIds.includes(tv.id)}
                      disabled={!tv.configured}
                      onChange={() => toggleTv(tv.id)}
                    />
                    <strong>{tv.name}</strong>
                    <span>{tv.online ? "Online" : tv.configured ? "Offline" : "Not configured"}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>

        <div className={styles.desktopSelection}>
          <span>Selected screens</span>
          <strong>{selectionLabel}</strong>
          <small>{selectedTvs.map((tv) => tv.name).join(", ")}</small>
        </div>

        <label htmlFor="site">Website</label>
        <select id="site" value={selectedSite} onChange={(event) => setSelectedSite(event.target.value)}>
          <option value="">Choose a website</option>
          {siteOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          <option value="custom">Custom website…</option>
        </select>

        {selectedSite === "custom" && (
          <label htmlFor="custom">
            Custom website
            <input id="custom" type="url" inputMode="url" value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://example.com" />
          </label>
        )}

        {error && <div className={styles.error}>{error}</div>}
        {message && <div className={styles.success}>{message}</div>}
        <button className={styles.primary} disabled={busy || !selectedTvIds.length || !selectedSite}>
          {busy ? "Sending…" : `Confirm and send to ${selectedTvs.length === 1 ? selectedTvs[0].name : `${selectedTvs.length} TVs`}`}
        </button>
      </form>
    </main>
  );
}
