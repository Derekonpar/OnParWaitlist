import Link from "next/link";
import { Logo } from "./Logo";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a0a]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-center px-4 py-4 sm:px-5">
        <Link href="/" className="flex items-center">
          <Logo className="h-10 w-auto max-w-[180px] object-contain object-left" />
        </Link>
      </div>
    </header>
  );
}
