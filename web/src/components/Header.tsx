import Link from "next/link";
import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4 sm:px-5">
        <Link href="/" className="flex items-center">
          <Logo className="h-10 w-auto max-w-[180px] object-contain object-left" />
        </Link>
        <Link
          href="/staff"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-white/10 hover:text-white"
        >
          Staff
        </Link>
      </div>
    </header>
  );
}
