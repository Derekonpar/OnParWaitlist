import Image from "next/image";

/**
 * Logo file — replace the image in public/images/
 * See public/images/README.md
 */
export const LOGO_SRC = "/images/on-par-logo.png";

export function Logo({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <Image
      src={LOGO_SRC}
      alt="On Par Entertainment"
      width={160}
      height={40}
      className={className}
      priority
    />
  );
}
