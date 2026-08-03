-- Allow staff to banish served/removed parties into a hidden archive.
-- Run this in the Supabase SQL editor (once) before using Delete on staff.

alter table waitlist_entries drop constraint if exists waitlist_entries_status_check;

alter table waitlist_entries
  add constraint waitlist_entries_status_check
  check (status in ('waiting', 'notified', 'served', 'cancelled', 'archived'));
