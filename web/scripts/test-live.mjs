/**
 * Legacy smoke-test entrypoint retained for operator muscle memory.
 *
 * This test is intentionally read-only. It delegates to the production-safe
 * board/health/page probe and never creates guests, sessions, or SMS attempts.
 * Run: node scripts/test-live.mjs [baseUrl]
 */
console.warn(
  "test-live now runs the read-only production smoke test; no waitlist data will be changed.",
);
process.argv[2] ??= "http://127.0.0.1:3000";
await import("./test-production-readonly.mjs");
