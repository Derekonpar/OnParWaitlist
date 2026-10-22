# Waitlist session baseline review

This is an owner diagnostic for draft PR #3, not a repair or rollout script.
The October 22 Preview failure is in
`20260813000000_allow_30_minute_resource_sessions.sql`: it alters
`public.activity_resource_sessions` before that table exists. The current
repository creates the table in setup SQL outside the migration sequence.
The later session-identity migration has not been reached by this failed replay.

## Collect the evidence

1. Verify the intended project and branch in the Supabase dashboard. The observed
   failed preview is `qejrqjiksedquiurlvut`; its expected parent is
   `flgitziapcemlzxupqnn`. Reconfirm these identities before using any SQL Editor.
   A database name such as `postgres` does not identify a Supabase project.
2. In a fresh SQL Editor session, run the entire
   [`inspect_resource_session_baseline.sql`](inspect_resource_session_baseline.sql)
   file on the preview, and separately on the verified parent if authorized.
   It reads system catalogs inside a read-only transaction and rolls back.
   It works when the target table or migration-history table is absent. It reads
   no guest/session rows and makes no schema, permission or history changes.
3. Save each result privately with its project/branch ID, current Git SHA and
   workflow error. It contains column/default, constraint/index, RLS/policy and
   effective API-role privilege metadata. Review privileges together with RLS;
   a table grant alone does not establish effective row access. Missing roles
   are omitted. `mayApply` is always false.
4. Have the owner privately compare the complete recorded migration history and
   actual parent schema with the repository, including setup SQL and any manually
   applied changes. The diagnostic only reports whether the history relation
   exists; it does not export history SQL, prove execution history or perform
   that reconciliation. Return a reviewed mapping and proposed exact repair,
   not raw SQL exports or guest data in a public PR.

## Interpret the session-table evidence

| Observation | Required review before any mutation |
| --- | --- |
| Table absent on preview | Confirm the missing creation step and the rest of the fresh-database baseline, using the parent history/schema. Adding another late migration cannot fix a failure in an earlier file. |
| Table also absent on parent | Stop treating the setup file as evidence of live storage. Verify the app's actual database/storage path before proposing a baseline. |
| Parent table exists without `session_id` | Confirm its complete columns, resource primary key, valid indexes and constraints match the intended legacy table before reviewing the additive identity migration. Preserve existing occupancy. |
| `session_id` already exists | Compare its UUID type, non-null/default and valid uniqueness, plus actual history. Do not replay the additive `ADD COLUMN` migration or mark it applied merely because a similarly named column exists. |
| Partial/invalid structure, unexpected relation kind, grants or RLS | Resolve the difference explicitly in the owner's proposed repair. Catalog output alone never authorizes changing permissions or adopting history. |

The current `schema.sql` and `add_activity_resource_sessions.sql` already contain
`session_id`; blindly running them and then replaying the additive identity
migration would produce a duplicate-column failure. These generic setup files
also contain broader schema/security operations. Do not use them as an automatic
fix for this existing project's failed Preview.

Once the owner has a reviewed proposal, validate the complete migration sequence
in a disposable database and test legacy occupancy preservation before requesting
the separate hosted action. Keep production and the current Preview untouched
until that action is authorized. Do not delete/recreate a Preview, repair history,
rename previously applied files or push all SQL as a troubleshooting shortcut.
Event Host's source-only rollout is separate and must not include this work.

Run the isolated local checks with `npm run test:resource-postgres` from `web/`.
They create a loopback-only disposable PostgreSQL instance without reading hosted
credentials. The checks cover absent/legacy/current schemas, effective privilege
metadata, read-only enforcement, row preservation and concurrent session writes.

Supabase's [missing-table branch troubleshooting guide](https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status)
explains the migration-history/schema dependency. Its generic repair examples
are not a reviewed repair plan for these projects.
