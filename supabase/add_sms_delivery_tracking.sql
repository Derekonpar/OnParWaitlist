-- Safe to re-run. Adds consent evidence and Twilio delivery tracking.
alter table waitlist_entries
  add column if not exists notification_count integer not null default 0,
  add column if not exists join_sms_sid text,
  add column if not exists join_sms_status text,
  add column if not exists join_sms_error_code text,
  add column if not exists join_sms_at timestamptz,
  add column if not exists last_sms_sid text,
  add column if not exists last_sms_status text,
  add column if not exists last_sms_kind text,
  add column if not exists last_sms_error_code text,
  add column if not exists last_sms_at timestamptz,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_consent_source text;

create index if not exists idx_waitlist_join_sms_sid
  on waitlist_entries (join_sms_sid)
  where join_sms_sid is not null;

create index if not exists idx_waitlist_last_sms_sid
  on waitlist_entries (last_sms_sid)
  where last_sms_sid is not null;

update waitlist_entries
set notification_count = 1
where notified_at is not null and notification_count = 0;
