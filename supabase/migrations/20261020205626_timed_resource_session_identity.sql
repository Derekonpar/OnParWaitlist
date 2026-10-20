-- Identity changes on every new checkout, even when the same resource is reused.
-- Existing sessions keep their occupancy and receive a distinct identity.
-- Apply only after reviewing this migration on the intended Waitlist database.
begin;

alter table public.activity_resource_sessions
  add column session_id uuid not null default gen_random_uuid();

alter table public.activity_resource_sessions
  add constraint activity_resource_sessions_session_id_key unique (session_id);

commit;
