-- Owner-run diagnostic, NOT a migration. Run in a fresh SQL Editor session.
-- Reads catalogs only: no session rows, guest data, schema or history writes.
-- Keep the output private; pair it with the verified dashboard project/branch ID.
begin isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
set local search_path = pg_catalog;

with target as (
  select c.* from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'activity_resource_sessions'
)
select jsonb_build_object(
  'reportVersion', 1,
  'observedAt', transaction_timestamp(),
  'database', current_database(),
  'databaseRole', current_user,
  'serverVersion', current_setting('server_version'),
  'transactionReadOnly', current_setting('transaction_read_only'),
  'mayApply', false,
  'requiresOwnerReview', true,
  'relation', 'public.activity_resource_sessions',
  'exists', exists(select 1 from target),
  'relationKind', (select relkind from target),
  'rowSecurityEnabled', (select relrowsecurity from target),
  'rowSecurityForced', (select relforcerowsecurity from target),
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated, 'default', pg_get_expr(d.adbin, d.adrelid)
    ) order by a.attnum)
    from pg_attribute a join target t on t.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.conname, 'type', c.contype, 'validated', c.convalidated,
      'definition', pg_get_constraintdef(c.oid, true)
    ) order by c.conname)
    from pg_constraint c join target t on t.oid = c.conrelid
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', c.relname, 'unique', i.indisunique, 'primary', i.indisprimary,
      'valid', i.indisvalid, 'ready', i.indisready,
      'definition', pg_get_indexdef(i.indexrelid)
    ) order by c.relname)
    from pg_index i join target t on t.oid = i.indrelid
    join pg_class c on c.oid = i.indexrelid
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', policyname, 'command', cmd, 'roles', roles,
      'permissive', permissive, 'using', qual, 'withCheck', with_check
    ) order by policyname)
    from pg_policies
    where schemaname = 'public' and tablename = 'activity_resource_sessions'
  ), '[]'::jsonb),
  -- These are privileges, NOT proof that RLS permits or denies a particular row.
  -- Missing roles are omitted. Inherited/PUBLIC and column grants are included.
  'apiRolePrivileges', coalesce((
    select jsonb_agg(jsonb_build_object(
      'role', r.rolname, 'bypassRls', r.rolbypassrls,
      'schemaUsage', has_schema_privilege(r.oid, t.relnamespace, 'USAGE'),
      'selectAnyColumn', has_any_column_privilege(r.oid, t.oid, 'SELECT'),
      'insertAnyColumn', has_any_column_privilege(r.oid, t.oid, 'INSERT'),
      'updateAnyColumn', has_any_column_privilege(r.oid, t.oid, 'UPDATE'),
      'delete', has_table_privilege(r.oid, t.oid, 'DELETE'),
      'truncate', has_table_privilege(r.oid, t.oid, 'TRUNCATE')
    ) order by r.rolname)
    from pg_roles r cross join target t
    where r.rolname in ('anon', 'authenticated', 'service_role')
  ), '[]'::jsonb),
  'migrationHistoryRelationExists', exists(
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations'
  )
) as report;

rollback;
