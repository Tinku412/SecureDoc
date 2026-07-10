-- SecureDoc migration v3
-- Run this in the Supabase SQL editor after migration_v2.sql.
-- Switches from one-link-per-viewer to one-link-per-type with a recipient list.

-- -----------------------------------------------------------------------
-- New table: per-link email allowlist
-- -----------------------------------------------------------------------
create table if not exists public.link_recipients (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid not null references public.share_links (id) on delete cascade,
  email      text not null,
  added_at   timestamptz not null default now(),
  unique (link_id, email)
);

create index if not exists idx_link_recipients_link on public.link_recipients (link_id);

alter table public.link_recipients enable row level security;

-- Owners can manage recipients for their own document links.
create policy "owners manage link recipients"
  on public.link_recipients for all
  using (exists (
    select 1 from public.share_links sl
    join public.documents d on d.id = sl.document_id
    where sl.id = link_recipients.link_id and d.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.share_links sl
    join public.documents d on d.id = sl.document_id
    where sl.id = link_recipients.link_id and d.owner_id = auth.uid()
  ));

-- -----------------------------------------------------------------------
-- Add require_verification to share_links
-- -----------------------------------------------------------------------
alter table public.share_links
  add column if not exists require_verification boolean not null default true;

-- Migrate: existing is_public=true links become require_verification=false.
update public.share_links set require_verification = false where is_public = true;

-- -----------------------------------------------------------------------
-- Migrate existing per-viewer links into link_recipients
-- (old model: one share_link row per viewer email)
-- -----------------------------------------------------------------------
insert into public.link_recipients (link_id, email)
select id, lower(trim(allowed_email))
from public.share_links
where allowed_email is not null and trim(allowed_email) != ''
on conflict (link_id, email) do nothing;
