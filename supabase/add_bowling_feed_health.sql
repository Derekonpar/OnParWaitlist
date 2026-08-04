alter table bowling_lane_state
  add column if not exists health_status text not null default 'ok',
  add column if not exists health_message text,
  add column if not exists health_updated_at timestamptz not null default now();

do $$ begin
  alter table bowling_lane_state
    add constraint bowling_lane_state_health_status_check
    check (health_status in ('ok', 'recovering', 'login-required', 'remote-offline', 'error'));
exception when duplicate_object then null;
end $$;

