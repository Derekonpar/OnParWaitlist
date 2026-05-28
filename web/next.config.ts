import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo: trace deps from repo root when Vercel builds via workspace
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
