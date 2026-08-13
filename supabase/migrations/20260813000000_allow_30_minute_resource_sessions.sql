alter table public.activity_resource_sessions
  drop constraint if exists activity_resource_sessions_duration_minutes_check;

alter table public.activity_resource_sessions
  add constraint activity_resource_sessions_duration_minutes_check
  check (duration_minutes in (30, 60, 120));
