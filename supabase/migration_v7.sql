-- SecureDoc migration v7
-- Run in the Supabase SQL editor after migration_v6.sql.
--
-- Adds an optional call-to-action overlay per link: a headline and a
-- button (label + URL) shown as a fixed banner over the document while a
-- viewer is reading it. All three fields are optional — the overlay only
-- renders once a button label and URL are both set.

alter table public.share_links add column if not exists cta_headline text;
alter table public.share_links add column if not exists cta_button_text text;
alter table public.share_links add column if not exists cta_button_url text;
