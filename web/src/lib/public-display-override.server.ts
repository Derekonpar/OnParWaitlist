import "server-only";
import { readEnv } from "./env";

/** Temporary presentation only. Never use this for availability or controls. */
export function isPublicBowlingNoWaitOverrideEnabled(): boolean {
  return readEnv("PUBLIC_BOWLING_NO_WAIT_OVERRIDE") === "true";
}
