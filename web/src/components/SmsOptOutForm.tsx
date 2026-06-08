"use client";

import { useState } from "react";

export function SmsOptOutForm() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/sms/opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setMessage(data.message);
      setPhone("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="opt-out-phone"
          className="mb-1.5 block text-sm font-medium text-neutral-300"
        >
          Mobile number to unsubscribe
        </label>
        <input
          id="opt-out-phone"
          type="tel"
          required
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 123-4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
        />
      </div>
      {error && (
        <p className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl border border-neutral-600 bg-neutral-900 px-4 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {loading ? "Processing…" : "Unsubscribe from texts"}
      </button>
    </form>
  );
}
