/** Read env that works on Next.js locally and OpenNext Cloudflare Workers. */
export function readEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const value = getCloudflareContext()?.env?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  } catch {
    // Local Next.js / non-Workers runtime
  }

  return undefined;
}
