-- SecureDoc migration v5
-- Run in the Supabase SQL editor after migration_v4.sql.
--
-- 1. Rebuilds the link_recipients RLS policy using a SECURITY DEFINER
--    helper function. The previous policy (migration_v3.sql) compared
--    against a subquery on share_links/documents, which are themselves
--    RLS-protected — in some Postgres/Supabase setups this nested check
--    can evaluate to false even for the rightful owner, causing
--    "new row violates row-level security policy for table link_recipients"
--    on INSERT. A SECURITY DEFINER function bypasses that nested RLS
--    evaluation and checks ownership directly.
-- 2. Adds per-link watermark style settings.

-- ---------------------------------------------------------------------------
-- 1. Fix link_recipients RLS
-- ---------------------------------------------------------------------------
create or replace function public.user_owns_link(p_link_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.share_links sl
    join public.documents d on d.id = sl.document_id
    where sl.id = p_link_id and d.owner_id = auth.uid()
  );
$$;

grant execute on function public.user_owns_link(uuid) to authenticated;

drop policy if exists "owners manage link recipients" on public.link_recipients;

create policy "owners manage link recipients"
  on public.link_recipients for all
  to authenticated
  using (public.user_owns_link(link_id))
  with check (public.user_owns_link(link_id));

-- ---------------------------------------------------------------------------
-- 2. Watermark style settings (per link)
-- ---------------------------------------------------------------------------
alter table public.share_links
  add column if not exists watermark_layout text not null default 'single_line';
alter table public.share_links
  add column if not exists watermark_direction text not null default 'diagonal';
alter table public.share_links
  add column if not exists watermark_repeat text not null default 'single';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'watermark_layout_check') then
    alter table public.share_links
      add constraint watermark_layout_check
      check (watermark_layout in ('single_line', 'stacked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watermark_direction_check') then
    alter table public.share_links
      add constraint watermark_direction_check
      check (watermark_direction in ('diagonal', 'horizontal', 'vertical'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'watermark_repeat_check') then
    alter table public.share_links
      add constraint watermark_repeat_check
      check (watermark_repeat in ('single', 'tiled'));
  end if;
end $$;
