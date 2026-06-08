import QRCode from "qrcode";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default async function QrPage() {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://on-par-waitlist.vercel.app");

  const waitlistUrl = baseUrl.replace(/\/$/, "");
  const qrDataUrl = await QRCode.toDataURL(waitlistUrl, {
    width: 320,
    margin: 2,
    color: { dark: "#fafafa", light: "#0a0a0a" },
  });

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

        <div className="mt-10 rounded-3xl border border-white/10 bg-[#141414] p-6 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`QR code for ${waitlistUrl}`}
            width={320}
            height={320}
            className="mx-auto rounded-2xl"
          />
        </div>

        <p className="mt-6 break-all text-sm font-mono text-neutral-500">
          {waitlistUrl}
        </p>

        <p className="mt-8 text-xs text-neutral-500">
          Print for lobby signage ·{" "}
          <a href="/staff" className="text-neutral-300 underline">
            Staff console
          </a>
        </p>
      </main>
    </>
  );
}
