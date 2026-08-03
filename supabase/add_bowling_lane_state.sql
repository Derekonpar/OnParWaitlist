-- Run this once in Supabase SQL Editor before starting the Brunswick watcher.
create table if not exists bowling_lane_state (
  id text primary key default 'current',
  lanes jsonb not null,
  source text,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table bowling_lane_state disable row level security;

do $$ begin
  alter table bowling_lane_state
    add constraint bowling_lane_state_current_check
    check (id = 'current');
exception when duplicate_object then null;
end $$;
