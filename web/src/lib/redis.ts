import { Redis } from "@upstash/redis";

/** Shared Upstash client — supports Vercel Marketplace env var names. */
export function getRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function hasRedisConfigured(): boolean {
  return getRedis() !== null;
}

export function isVercelProduction(): boolean {
  return Boolean(process.env.VERCEL);
}
