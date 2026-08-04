-- Current timed checkouts for pool tables and shuffleboards.
create table if not exists activity_resource_sessions (
  resource_type text not null
    check (resource_type in ('pool', 'shuffleboard')),
  resource_id text not null,
  guest_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null
    check (duration_minutes in (60, 120)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_type, resource_id),
  check (ends_at > starts_at),
  check (
    (resource_type = 'pool' and resource_id in ('red', 'green', 'blue')) or
    (resource_type = 'shuffleboard' and resource_id in ('1', '2'))
  )
);

alter table activity_resource_sessions disable row level security;

