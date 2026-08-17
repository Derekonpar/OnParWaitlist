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
import { defaultSessionMinutesFor } from "@/lib/booking";

interface JoinModalProps {
  activity: Activity;
  onClose: () => void;
}

export function JoinModal({ activity, onClose }: JoinModalProps) {
  const theme = ACTIVITY_THEME[activity];
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [laneCount, setLaneCount] = useState<LaneCount>(1);
  const [sessionMinutes, setSessionMinutes] = useState<SessionDuration>(
    defaultSessionMinutesFor(activity),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const smsOptIn = true;

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a complete 10-digit mobile number.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone,
          smsOptIn,
          laneCount,
          sessionMinutes,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      if (smsOptIn && data.smsSent === false) {
        window.location.href = `/status/${data.entry.id}?sms=failed`;
        return;
      }

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
                Your name will appear on the public waitlist and TV
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="firstName"
                className="mb-1.5 block text-sm font-medium text-neutral-300"
              >
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                autoComplete="given-name"
                placeholder="Jordan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="mb-1.5 block text-sm font-medium text-neutral-300"
              >
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                required
                autoComplete="family-name"
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
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

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs leading-relaxed text-emerald-50/90">
            By choosing <strong>Join &amp; get text updates</strong>, you agree
            to receive transactional waitlist texts from On Par Entertainment
            at the number provided. Message frequency varies. Message and data
            rates may apply. Reply STOP to opt out or HELP for help. Consent is
            not a condition of purchase.{" "}
            <a href="/sms" className="font-semibold underline hover:text-white">
              SMS terms and privacy
            </a>
            <span className="mt-2 block text-emerald-100/70">
              Your name will be shown on our public waitlist screens. Self-service
              signup requires text updates. If you do not want texts, see a staff
              member to be added manually and watch the TV waitlist for your name.
            </span>
          </div>

          {error && (
            <p className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? "Joining…" : "Join waitlist & receive texts"}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-1 text-xs text-neutral-500 hover:text-neutral-300"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
