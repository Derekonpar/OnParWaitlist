import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4 sm:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-sm font-bold text-white shadow-lg shadow-violet-500/30">
            OP
          </span>
          <div>
            <span className="block text-sm font-semibold leading-tight text-white">
              On Par
            </span>
            <span className="block text-xs text-neutral-500">Entertainment</span>
          </div>
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
