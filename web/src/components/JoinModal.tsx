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
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-title"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        data-join-modal-card
        className="relative max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-[#141414] shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <div
          className={`bg-gradient-to-br ${theme.gradient} px-4 py-3 sm:px-6 sm:py-5`}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white sm:h-11 sm:w-11 sm:rounded-2xl">
              <ActivityIcon
                activity={activity}
                className="h-5 w-5 sm:h-6 sm:w-6"
              />
            </span>
            <div>
              <h2 id="join-title" className="text-lg font-semibold text-white">
                Join {ACTIVITY_LABELS[activity]}
              </h2>
              <p className="text-xs text-white/80 sm:text-sm">
                Your name will appear on the public waitlist and TV
              </p>
            </div>
          </div>
        </div>

        <form
          data-join-modal-form
          onSubmit={handleSubmit}
          className="space-y-3 p-4 sm:space-y-4 sm:p-6"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="firstName"
                className="mb-1 block text-xs font-medium text-neutral-300 sm:mb-1.5 sm:text-sm"
              >
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                maxLength={40}
                autoComplete="given-name"
                placeholder="Jordan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-base text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 sm:px-4 sm:py-3"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="mb-1 block text-xs font-medium text-neutral-300 sm:mb-1.5 sm:text-sm"
              >
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                required
                maxLength={40}
                autoComplete="family-name"
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-base text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 sm:px-4 sm:py-3"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="phone"
              className="mb-1 block text-xs font-medium text-neutral-300 sm:mb-1.5 sm:text-sm"
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
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-base text-white placeholder:text-neutral-500 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 sm:px-4 sm:py-3"
            />
          </div>

          <BookingOptions
            activity={activity}
            laneCount={laneCount}
            sessionMinutes={sessionMinutes}
            onLaneCountChange={setLaneCount}
            onSessionMinutesChange={setSessionMinutes}
            compact
          />

          <div
            data-join-consent
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] leading-4 text-emerald-50/90 sm:p-4 sm:text-xs sm:leading-relaxed"
          >
            By choosing <strong>Join waitlist &amp; receive texts</strong>, you
            consent to transactional waitlist texts from On Par Entertainment.
            Message frequency varies; message and data rates may apply. Reply
            STOP to opt out or HELP for help. Consent is not a condition of
            purchase.{" "}
            <a href="/sms" className="font-semibold underline hover:text-white">
              SMS terms and privacy
            </a>
            <span className="mt-1.5 block text-emerald-100/70 sm:mt-2">
              Your name appears on public waitlist screens. Self-service requires
              texts. To join without texts, ask staff to add you, then watch the
              TV for your turn.
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
              className="w-full rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:opacity-60 sm:py-3"
            >
              {loading ? "Joining…" : "Join waitlist & receive texts"}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-0.5 text-xs text-neutral-500 hover:text-neutral-300 sm:py-1"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
