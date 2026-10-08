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
type HubState = { checkedAt: string; tvs: Tv[]; sources: Source[] };

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

export default function TvHubPage() {
  const [secret, setSecret] = useState("");
  const [pin, setPin] = useState("");
  const [hub, setHub] = useState<HubState | null>(null);
  const [selectedTv, setSelectedTv] = useState("");
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
      const sorted = { ...body, tvs: [...body.tvs].sort((a: Tv, b: Tv) => tvNumber(a.name) - tvNumber(b.name)) } as HubState;
      setHub(sorted);
      setSelectedTv((current) => current || sorted.tvs[0]?.id || "");
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
    if (!selectedTv || !selectedSite) return setError("Choose a TV and a website.");
    const payload: { tvId: string; sourceId?: string; url?: string } = { tvId: selectedTv };
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
      setHub({ ...body.state, tvs: [...body.state.tvs].sort((a: Tv, b: Tv) => tvNumber(a.name) - tvNumber(b.name)) });
      setMessage(body.message);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The website was not sent.");
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

  const chosenTv = hub.tvs.find((tv) => tv.id === selectedTv);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>On Par staff controls</div>
          <h1>TV Hub</h1>
          <p>Choose a screen, choose a website, then send it.</p>
        </div>
        <button className={styles.secondary} onClick={() => void load(secret)} disabled={busy}>Refresh</button>
      </header>

      <section className={styles.desktopGrid} aria-label="TV screens">
        {hub.tvs.map((tv) => (
          <button key={tv.id} type="button" className={`${styles.tvCard} ${selectedTv === tv.id ? styles.selected : ""}`} onClick={() => setSelectedTv(tv.id)}>
            <span className={`${styles.statusDot} ${tv.online ? styles.online : styles.offline}`} />
            <strong>{tv.name}</strong>
            <span>{siteName(tv, hub.sources)}</span>
            <small>{tv.online ? "Online" : tv.configured ? "Offline" : "Not configured"}</small>
          </button>
        ))}
      </section>

      <form className={styles.controlCard} onSubmit={send}>
        <div className={styles.mobileTvField}>
          <label htmlFor="tv">TV number</label>
          <select id="tv" value={selectedTv} onChange={(event) => setSelectedTv(event.target.value)}>
            {hub.tvs.map((tv) => <option key={tv.id} value={tv.id}>{tv.name}{tv.online ? "" : " — offline"}</option>)}
          </select>
        </div>

        <div className={styles.desktopSelection}>
          <span>Selected screen</span>
          <strong>{chosenTv?.name || "Choose a TV"}</strong>
          <small>{chosenTv ? siteName(chosenTv, hub.sources) : ""}</small>
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
        <button className={styles.primary} disabled={busy || !selectedTv || !selectedSite}>{busy ? "Sending…" : `Confirm and send to ${chosenTv?.name || "TV"}`}</button>
      </form>
    </main>
  );
}
