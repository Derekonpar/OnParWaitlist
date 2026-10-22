This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
## Event Host interval evidence

The schedule cache preserves a separate `sourceSnapshot` containing Event Host's
original dates, allocation projection and evidence envelope. Capture happens
before the existing operating-day display filter, so spanning allocations and
buyouts without allocation rows remain in the source evidence. Stored and memory
cache reads do not replace upstream timestamps with the mirror's `fetchedAt`.
Missing or malformed envelopes yield no source snapshot.

Leave `ENTERTAINMENT_INTERVAL_EVIDENCE=false` until Event Host's version 2
interval migration and authenticated responses are verified. `true` requests
`coverage=interval`; this is evidence transport only. Existing operational
booking checks are unchanged, and no shared claim authority is enabled. A future
availability consumer must check the original coverage, issues and timestamps,
not infer complete coverage from today's filtered display reservations.

Run the evidence tests with Node 24:
`node --experimental-strip-types --test scripts/test-source-evidence.mjs`.
Also run `npm run lint`, `npx tsc --noEmit`, and `npm run build`.

## Timed pool and shuffleboard session protection (draft)

New sessions use an insert against the existing `(resource_type, resource_id)`
primary key. Concurrent starts cannot overwrite one another. An ended timer
still occupies the resource until staff collect the equipment and explicitly
clear that checkout. Each checkout has a database-generated `sessionId`; clearing
requires both the resource and that exact ID. A stale or repeated clear returns
409 and cannot delete a later checkout. The staff screen refreshes after a
conflict or uncertain network result and never automatically retries a mutation.

The API also rejects future-dated schedule freshness and treats invalid or
reversed reservation clocks as blocking that resource. Missing storage or
session identities cannot produce an empty, apparently available resource list.
Mini Golf remains uncapped and is not added to these timed resource controls.

### Migration and release gate

`../supabase/migrations/20261020205626_timed_resource_session_identity.sql` adds a
non-null UUID identity and uniqueness constraint to existing Waitlist sessions.
It preserves guests, occupancy and existing clocks. **Production application
requires owner approval** and is separate from Event Host PR #3's source-only
database handoff. The repository's existing Supabase Git integration may run it
automatically on a disposable PR branch. Inspect that branch's exact migration
result; creation of a preview branch alone is not successful schema acceptance.

Before deployment, the owner must identify the actual Waitlist database, compare
its session-table schema/history, approve only this additive migration and
verify existing rows receive distinct identities with occupancy unchanged.
Do not run a broad database push or apply this file to the Event Host database.
The canonical table creation scripts include the column for new installations;
do not rerun them as a substitute for upgrading an existing table. An already
present identity column needs inspection, not blind migration replay.

Deploy the matching server and staff UI together after database verification,
retire older server versions, and refresh open staff screens. Old clear requests
without a session ID are rejected. A missing migration fails closed; there is no
legacy upsert/delete fallback. Restoring old application code also restores its
unsafe write behavior. No manual hosted migration or production release is
included in this draft; automated PR-branch migration results must be checked
separately.

This closes Waitlist's local checkout overwrite/stale-clear race. It does not
atomically reserve against Event Host or REX, establish complete upstream
coverage, or close every privileged/direct database writer. Those remain shared
booking activation gates. The current cached schedule check can still race
another application's reservation; do not certify cross-application protection
from these tests alone.

### Local validation

Use Node 24 and `npm ci` (including the pinned native test dependency's install
script). Run from `web/`:

```sh
npm run test:resource-sessions
npm run test:resource-postgres
npm run lint
npx tsc --noEmit
npm run build
```

The API tests execute the real modules and installed PostgREST client against
controlled responses. The PostgreSQL runner creates its own disposable loopback
cluster, uses four separate connections, waits for actual lock contention, and
cleans up afterward. It never reads `DATABASE_URL` or contacts a hosted database.
It verifies migration preservation, competing starts, expired-but-uncollected
sessions, stale/wrong-resource clears, replacement while a clear waits,
simultaneous clears and a lost create response. Existing local source-evidence,
queue, pool-control, feed and reliability regression scripts should also pass.
