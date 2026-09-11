# Temporary public bowling display override

`PUBLIC_BOWLING_NO_WAIT_OVERRIDE` is a server-only, runtime setting. Only the exact string `true` enables it; absent, `false`, or any other value disables it. It defaults off. Do not use a `NEXT_PUBLIC_` variable.

When enabled, only the bowling summary on `/` and `/view` displays **No Wait**. The numbered guest queue and real board statistics are retained. Other entertainment, guest signup and individual status estimates, reservations, health checks, lane snapshots, watcher, allocation and staff controls are unchanged. Authenticated staff see an amber notice that the public display is overridden; staff lane status and real feed warnings remain visible. There is no public individual-lane graphic.

## Activation and rollback

After reviewing and deploying this code, set the production Worker's runtime variable `PUBLIC_BOWLING_NO_WAIT_OVERRIDE` to `true` through the existing Cloudflare release workflow. Preserve all existing variables and secrets. No database change is needed.

To remove the override after the native feed is verified, set the same variable to `false` or remove it. This does not require changing application code or rebuilding client JavaScript. Cloudflare must apply the new runtime configuration; existing pages receive the change on the next board poll (normally 15 seconds). A successful board response is not required to remove it: error/timeout responses also carry the switch while the browser preserves the last known queue. A browser completely disconnected from the site needs to reconnect or reload before it can receive a configuration change.

Verify `/api/waitlist/board` returns the expected boolean `bowlingNoWaitOverride`, both public bowling cards show the intended label, and the staff-only notice agrees. Confirm queue names/counts and other entertainment remain unchanged. This setting is presentation only and must never be used as evidence that a lane is actually free or the Brunswick feed is healthy.
