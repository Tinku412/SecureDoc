-- SecureDoc migration v4
-- Run in the Supabase SQL editor after migration_v3.sql.
-- Adds the restrict_to_recipients setting to share_links so
-- access can be locked to the recipient list independently of
-- the OTP verification toggle.

alter table public.share_links
  add column if not exists restrict_to_recipients boolean not null default false;
