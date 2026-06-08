"use client";

import { useState } from "react";
import {
  ACTIVITY_LABELS,
  ACTIVITY_THEME,
  type Activity,
  type LaneCount,
  type SessionDuration,
} from "@/lib/types";
import { ActivityIcon } from "./ActivityIcon";
import { BookingOptions } from "./BookingOptions";

interface JoinModalProps {
  activity: Activity;
  onClose: () => void;
}

export function JoinModal({ activity, onClose }: JoinModalProps) {
  const theme = ACTIVITY_THEME[activity];
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [rewardsOptIn, setRewardsOptIn] = useState(false);
  const [laneCount, setLaneCount] = useState<LaneCount>(1);
  const [sessionMinutes, setSessionMinutes] = useState<SessionDuration>(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          name,
          phone,
          smsOptIn,
          rewardsOptIn,
          laneCount,
          sessionMinutes,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      // Full navigation works reliably in iOS WKWebView (Next router often does not)
      window.location.href = `/status/${data.entry.id}`;
    } catch {
      setError("Network error. Check Wi‑Fi and that the server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-title"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#141414] shadow-2xl">
        <div className={`bg-gradient-to-br ${theme.gradient} px-6 py-5`}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-white">
              <ActivityIcon activity={activity} className="h-6 w-6" />
            </span>
            <div>
              <h2 id="join-title" className="text-lg font-semibold text-white">
                Join {ACTIVITY_LABELS[activity]}
              </h2>
              <p className="text-sm text-white/80">
                Everyone in line sees your first name
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label
              htmlFor="name"
              className="mb-1.5 block text-sm font-medium text-neutral-300"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              placeholder="Jordan Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label
              htmlFor="phone"
              className="mb-1.5 block text-sm font-medium text-neutral-300"
            >
              Mobile number
            </label>
            <input
              id="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <BookingOptions
            activity={activity}
            laneCount={laneCount}
            sessionMinutes={sessionMinutes}
            onLaneCountChange={setLaneCount}
            onSessionMinutesChange={setSessionMinutes}
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-900/80 p-4 has-[:checked]:border-emerald-500/50 has-[:checked]:bg-emerald-500/10">
            <input
              type="checkbox"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-neutral-600 text-emerald-500 focus:ring-emerald-500"
            />
            <span className="text-sm leading-relaxed text-neutral-400">
              <span className="font-medium text-neutral-100">
                Text me when I&apos;m up
              </span>
              <br />
              Optional SMS alerts. Standard rates may apply.{" "}
              <a href="/sms" className="underline hover:text-neutral-200">
                SMS program details
              </a>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-700 bg-neutral-900/80 p-4 has-[:checked]:border-violet-500/50 has-[:checked]:bg-violet-500/10">
            <input
              type="checkbox"
              checked={rewardsOptIn}
              onChange={(e) => setRewardsOptIn(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-neutral-600 text-violet-500 focus:ring-violet-500"
            />
            <span className="text-sm leading-relaxed text-neutral-400">
              <span className="font-medium text-neutral-100">
                Sign me up for rewards
              </span>
              <br />
              Optional. Earn perks on future visits.
            </span>
          </label>

          {error && (
            <p className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-neutral-600 px-4 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-60"
            >
              {loading ? "Joining…" : "Join waitlist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
