-- Run this in Supabase → SQL Editor (safe to re-run)
--
-- If you hit enum/type errors and have NO real data yet, you can reset first:
--   drop table if exists waitlist_entries;
--   drop table if exists customers;
--   drop type if exists "WaitlistStatus";
--   drop type if exists "Activity";

-- ── customers ──────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default gen_random_uuid()
);

alter table customers add column if not exists phone text;
alter table customers add column if not exists name text;
alter table customers add column if not exists first_seen_at timestamptz default now();
alter table customers add column if not exists last_seen_at timestamptz default now();
alter table customers add column if not exists visit_count integer default 1;
alter table customers add column if not exists rewards_opt_in boolean default false;
alter table customers add column if not exists sms_opted_out boolean default false;
alter table customers add column if not exists created_at timestamptz default now();

update customers set first_seen_at = now() where first_seen_at is null;
update customers set last_seen_at = now() where last_seen_at is null;
update customers set visit_count = 1 where visit_count is null;
update customers set rewards_opt_in = false where rewards_opt_in is null;
update customers set sms_opted_out = false where sms_opted_out is null;
update customers set created_at = now() where created_at is null;

alter table customers alter column first_seen_at set not null;
alter table customers alter column last_seen_at set not null;
alter table customers alter column visit_count set not null;
alter table customers alter column rewards_opt_in set not null;
alter table customers alter column sms_opted_out set not null;
alter table customers alter column created_at set not null;

do $$ begin
  alter table customers add constraint customers_phone_unique unique (phone);
exception when duplicate_object then null;
end $$;

-- ── waitlist_entries ───────────────────────────────────────
create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid()
);

-- Legacy GitHub integration may leave BOTH camelCase and snake_case columns
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='createdAt') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='created_at') then
      update waitlist_entries set created_at = "createdAt" where created_at is null and "createdAt" is not null;
      alter table waitlist_entries drop column "createdAt";
    else
      alter table waitlist_entries rename column "createdAt" to created_at;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='smsOptIn') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='sms_opt_in') then
      update waitlist_entries set sms_opt_in = "smsOptIn" where sms_opt_in is null and "smsOptIn" is not null;
      alter table waitlist_entries drop column "smsOptIn";
    else
      alter table waitlist_entries rename column "smsOptIn" to sms_opt_in;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='customerId') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='customer_id') then
      update waitlist_entries set customer_id = "customerId" where customer_id is null and "customerId" is not null;
      alter table waitlist_entries drop column "customerId";
    else
      alter table waitlist_entries rename column "customerId" to customer_id;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='notifiedAt') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='waitlist_entries' and column_name='notified_at') then
      update waitlist_entries set notified_at = "notifiedAt" where notified_at is null and "notifiedAt" is not null;
      alter table waitlist_entries drop column "notifiedAt";
    else
      alter table waitlist_entries rename column "notifiedAt" to notified_at;
    end if;
  end if;
end $$;

alter table customers disable row level security;
alter table waitlist_entries disable row level security;

alter table waitlist_entries add column if not exists customer_id uuid;
alter table waitlist_entries add column if not exists activity text;
alter table waitlist_entries add column if not exists name text;
alter table waitlist_entries add column if not exists phone text;
alter table waitlist_entries add column if not exists sms_opt_in boolean default false;
alter table waitlist_entries add column if not exists status text;
alter table waitlist_entries add column if not exists created_at timestamptz default now();
alter table waitlist_entries add column if not exists notified_at timestamptz;

-- GitHub/Supabase integration may create enum columns (e.g. WaitlistStatus).
-- Convert them to lowercase text so the app can use waiting / notified / etc.
do $$
declare
  status_udt text;
  activity_udt text;
begin
  select udt_name into status_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'waitlist_entries'
    and column_name = 'status';

  if status_udt is not null and status_udt not in ('text', 'varchar', 'bpchar') then
    alter table waitlist_entries alter column status drop default;
    alter table waitlist_entries
      alter column status type text
      using lower(status::text);
  end if;

  select udt_name into activity_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'waitlist_entries'
    and column_name = 'activity';

  if activity_udt is not null and activity_udt not in ('text', 'varchar', 'bpchar') then
    alter table waitlist_entries
      alter column activity type text
      using lower(activity::text);
  end if;
end $$;

alter table waitlist_entries alter column status set default 'waiting';

update waitlist_entries set sms_opt_in = false where sms_opt_in is null;
update waitlist_entries set status = 'waiting' where status is null;
update waitlist_entries set created_at = now() where created_at is null;

alter table waitlist_entries alter column sms_opt_in set not null;
alter table waitlist_entries alter column status set not null;
alter table waitlist_entries alter column created_at set not null;

do $$ begin
  alter table waitlist_entries
    add constraint waitlist_entries_customer_id_fkey
    foreign key (customer_id) references customers(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table waitlist_entries
    add constraint waitlist_entries_activity_check
    check (activity in ('bowling', 'darts', 'pool', 'shuffleboard'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table waitlist_entries
    add constraint waitlist_entries_status_check
    check (status in ('waiting', 'notified', 'served', 'cancelled'));
exception when duplicate_object then null;
end $$;

-- ── indexes ────────────────────────────────────────────────
create index if not exists idx_waitlist_activity_status
  on waitlist_entries (activity, status);

create index if not exists idx_waitlist_created
  on waitlist_entries (created_at);

create index if not exists idx_customers_phone
  on customers (phone);
