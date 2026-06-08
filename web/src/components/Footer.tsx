import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0a0a0a]/80 py-6">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-2 px-4 text-center text-xs text-neutral-500 sm:px-5">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <Link href="/sms" className="text-neutral-400 underline hover:text-white">
            SMS opt-in / opt-out
          </Link>
          <span className="text-neutral-700">·</span>
          <Link href="/qr" className="text-neutral-400 underline hover:text-white">
            Lobby QR
          </Link>
        </div>
        <p>On Par Entertainment · Waitlist</p>
      </div>
    </footer>
  );
}
