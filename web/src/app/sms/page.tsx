import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SmsOptOutForm } from "@/components/SmsOptOutForm";
import {
  getContactEmail,
  getPublicAppUrl,
  getVenueName,
  getVenuePhone,
  getVenuePhoneTel,
} from "@/lib/venue";

export const metadata = {
  title: "SMS Program — On Par Waitlist",
  description:
    "How to opt in and opt out of On Par Entertainment waitlist text message notifications.",
};

export default function SmsPage() {
  const venue = getVenueName();
  const phone = getVenuePhone();
  const phoneTel = getVenuePhoneTel();
  const email = getContactEmail();
  const appUrl = getPublicAppUrl();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-5">
        <h1 className="text-2xl font-semibold text-white">SMS notifications</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {venue} waitlist text message program
        </p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed text-neutral-300">
          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">Program description</h2>
            <p className="mt-2">
              {venue} offers optional SMS text messages to guests who join our
              venue waitlist for bowling, darts, pool, or shuffleboard. Messages
              notify you when it is your turn or confirm your place in line.
            </p>
          </article>

          <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <h2 className="text-base font-semibold text-emerald-200">How to opt in</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5">
              <li>
                Visit our waitlist at{" "}
                <a href={appUrl} className="text-white underline">
                  {appUrl}
                </a>{" "}
                or scan the lobby QR code.
              </li>
              <li>Tap <strong className="text-white">Get on waitlist</strong> for an activity.</li>
              <li>Enter your name and mobile number.</li>
              <li>
                Review the consent disclosure, then tap{" "}
                <strong className="text-white">Join waitlist &amp; receive texts</strong>.
              </li>
            </ol>
            <p className="mt-3 text-neutral-400">
              Opt-in is voluntary and consent is not a condition of purchase.
              Guests who prefer not to receive texts can ask the host for the
              non-SMS waitlist option.
            </p>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">How to opt out</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                Reply <strong className="text-white">STOP</strong> to any message
                from us (also works: STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT).
              </li>
              <li>Reply <strong className="text-white">START</strong> to resubscribe later.</li>
              <li>Reply <strong className="text-white">HELP</strong> for program info.</li>
              <li>Use the unsubscribe form below.</li>
            </ul>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">Message details</h2>
            <ul className="mt-2 space-y-2">
              <li>
                <span className="text-neutral-500">Frequency:</span> A few messages
                per visit — join confirmation and when you are called to check in.
              </li>
              <li>
                <span className="text-neutral-500">Cost:</span> Message and data
                rates may apply per your carrier.
              </li>
              <li>
                <span className="text-neutral-500">Privacy:</span> We use your
                number only for waitlist notifications. We do not sell your
                information.
              </li>
            </ul>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">Sample messages</h2>
            <div className="mt-3 space-y-3">
              <p className="rounded-xl bg-neutral-900 px-4 py-3 font-mono text-xs text-neutral-300">
                Thanks Jordan! You&apos;re #2 on the Bowling waitlist at {venue}.
                We&apos;ll text you when it&apos;s your turn. Reply STOP to opt out.
              </p>
              <p className="rounded-xl bg-neutral-900 px-4 py-3 font-mono text-xs text-neutral-300">
                Hi Jordan! You&apos;re up for Bowling at {venue}. Please check in
                at the front desk within 5 minutes. Reply STOP to opt out.
              </p>
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">Unsubscribe online</h2>
            <p className="mt-2 text-neutral-400">
              Enter the mobile number you used to join the waitlist.
            </p>
            <div className="mt-4">
              <SmsOptOutForm />
            </div>
          </article>

          <article className="rounded-2xl border border-white/10 bg-[#141414] p-5">
            <h2 className="text-base font-semibold text-white">Contact</h2>
            <p className="mt-2">
              {venue}
              <br />
              Phone:{" "}
              <a href={`tel:${phoneTel}`} className="text-white underline">
                {phone}
              </a>
              <br />
              Email:{" "}
              <a href={`mailto:${email}`} className="text-white underline">
                {email}
              </a>
            </p>
          </article>
        </section>

        <p className="mt-8 text-center">
          <Link href="/" className="text-sm text-neutral-400 hover:text-white">
            ← Back to waitlist
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
