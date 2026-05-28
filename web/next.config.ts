import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Twilio uses Node APIs — keep it out of the bundler on Vercel
  serverExternalPackages: ["twilio"],
};

export default nextConfig;
