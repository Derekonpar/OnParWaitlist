-- Quick fix if join/board return 500 but customers table works.
-- Safe to re-run. Run in Supabase → SQL Editor, then redeploy Vercel.

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid()
);

-- Merge duplicate camelCase + snake_case columns (GitHub integration left both)
do $$
begin
  -- createdAt → created_at
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='createdAt') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='created_at') then
      update waitlist_entries set created_at = "createdAt" where created_at is null and "createdAt" is not null;
      alter table waitlist_entries drop column "createdAt";
    else
      alter table waitlist_entries rename column "createdAt" to created_at;
    end if;
  end if;

  -- smsOptIn → sms_opt_in
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='smsOptIn') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='sms_opt_in') then
      update waitlist_entries set sms_opt_in = "smsOptIn" where sms_opt_in is null and "smsOptIn" is not null;
      alter table waitlist_entries drop column "smsOptIn";
    else
      alter table waitlist_entries rename column "smsOptIn" to sms_opt_in;
    end if;
  end if;

  -- customerId → customer_id
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='customerId') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='customer_id') then
      update waitlist_entries set customer_id = "customerId" where customer_id is null and "customerId" is not null;
      alter table waitlist_entries drop column "customerId";
    else
      alter table waitlist_entries rename column "customerId" to customer_id;
    end if;
  end if;

  -- notifiedAt → notified_at
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='notifiedAt') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='notified_at') then
      update waitlist_entries set notified_at = "notifiedAt" where notified_at is null and "notifiedAt" is not null;
      alter table waitlist_entries drop column "notifiedAt";
    else
      alter table waitlist_entries rename column "notifiedAt" to notified_at;
    end if;
  end if;

  -- joinedAt → created_at (only if created_at still missing)
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='created_at')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='joinedAt') then
    alter table waitlist_entries rename column "joinedAt" to created_at;
  elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='joinedAt') then
    update waitlist_entries set created_at = "joinedAt" where created_at is null and "joinedAt" is not null;
    alter table waitlist_entries drop column "joinedAt";
  end if;
end $$;

alter table waitlist_entries add column if not exists customer_id uuid;
alter table waitlist_entries add column if not exists activity text;
alter table waitlist_entries add column if not exists name text;
alter table waitlist_entries add column if not exists phone text;
alter table waitlist_entries add column if not exists sms_opt_in boolean default false;
alter table waitlist_entries add column if not exists status text default 'waiting';
alter table waitlist_entries add column if not exists created_at timestamptz default now();
alter table waitlist_entries add column if not exists notified_at timestamptz;

update waitlist_entries set sms_opt_in = false where sms_opt_in is null;
update waitlist_entries set created_at = now() where created_at is null;

-- Convert enum status → lowercase text
do $$
declare status_udt text;
begin
  select udt_name into status_udt
  from information_schema.columns
  where table_schema='public' and table_name='waitlist_entries' and column_name='status';
  if status_udt is not null and status_udt not in ('text','varchar','bpchar') then
    alter table waitlist_entries alter column status drop default;
    alter table waitlist_entries alter column status type text using lower(status::text);
    alter table waitlist_entries alter column status set default 'waiting';
  end if;
end $$;

update waitlist_entries set status = 'waiting' where status is null;

-- Legacy GitHub schema requires publicToken on every row
alter table waitlist_entries add column if not exists "publicToken" text;
update waitlist_entries set "publicToken" = id::text where "publicToken" is null;
alter table waitlist_entries alter column "publicToken" set default gen_random_uuid()::text;

do $$ begin
  alter table waitlist_entries alter column "publicToken" set not null;
exception when others then null;
end $$;

-- Backfill null names from customers where possible
update waitlist_entries w
set name = c.name
from customers c
where w.name is null and w.customer_id = c.id;

update waitlist_entries set name = 'Guest' where name is null;

alter table waitlist_entries add column if not exists "displayName" text;
update waitlist_entries
set "displayName" = coalesce("displayName", name, 'Guest')
where "displayName" is null;

alter table waitlist_entries add column if not exists "partySize" integer default 1;
update waitlist_entries set "partySize" = 1 where "partySize" is null;

alter table customers disable row level security;
alter table waitlist_entries disable row level security;
