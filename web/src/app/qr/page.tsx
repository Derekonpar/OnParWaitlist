import { Header } from "@/components/Header";

const WAITLIST_URL = "https://onparwaitlist.com";

export default function QrPage() {
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center px-5 py-12 text-center">
        <h1 className="text-2xl font-semibold text-white">
          Scan to join the waitlist
        </h1>
        <p className="mt-2 max-w-xs text-sm text-neutral-400">
          Point your camera at the code. Everyone sees the same live line.
        </p>

        <div className="mt-10 rounded-3xl border border-white/10 bg-white p-6 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/waitlist-qr.png"
            alt={`QR code for ${WAITLIST_URL}`}
            width={320}
            height={320}
            className="mx-auto"
          />
        </div>

        <p className="mt-8 text-xs text-neutral-500">
          Print for lobby signage
        </p>
      </main>
    </>
  );
}
