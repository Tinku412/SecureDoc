-- SecureDoc migration v8
-- Run in the Supabase SQL editor after migration_v7.sql.
--
-- Supports multiple simultaneous active links per document, each with its
-- own independent settings:
--   1. `name` — optional owner-facing label to tell links apart in the
--      dashboard (e.g. "Investor update", "Public").
--   2. `download_allowed` moves from the document to the link, since
--      download permission is now a per-link setting like everything else
--      (access controls, watermark style, CTA overlay).

alter table public.share_links add column if not exists name text;
alter table public.share_links add column if not exists download_allowed boolean not null default true;
