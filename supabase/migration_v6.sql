-- SecureDoc migration v6
-- Run in the Supabase SQL editor after migration_v5.sql.
--
-- Owner-side Google sign-in has been removed from the app for now (to be
-- reintroduced later). Without a signed-in owner there is no auth.uid() to
-- scope documents/links/sessions to, so this migration opens up the
-- previously owner-scoped RLS policies and storage policies so the
-- dashboard works fully under the anon key. This is a single-tenant,
-- fully-open dashboard for the MVP build-out — re-tighten these back to
-- auth.uid()-based checks once real owner auth is added back
-- (see schema.sql / migration_v3.sql / migration_v5.sql for the previous
-- per-owner shape).

-- ---------------------------------------------------------------------------
-- 1. owner_id is no longer populated (no session to read it from).
-- ---------------------------------------------------------------------------
alter table public.documents alter column owner_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Replace owner-scoped RLS policies with fully open ones.
-- ---------------------------------------------------------------------------
drop policy if exists "owners manage own documents" on public.documents;
create policy "open manage documents"
  on public.documents for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "owners manage own share links" on public.share_links;
create policy "open manage share links"
  on public.share_links for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "owners read own view sessions" on public.view_sessions;
create policy "open read view sessions"
  on public.view_sessions for select
  to anon, authenticated
  using (true);

drop policy if exists "owners read own page views" on public.page_views;
create policy "open read page views"
  on public.page_views for select
  to anon, authenticated
  using (true);

drop policy if exists "owners manage link recipients" on public.link_recipients;
create policy "open manage link recipients"
  on public.link_recipients for all
  to anon, authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. Storage — open up the documents bucket the same way. Files no longer
--    live under an {owner_id}/ folder since there's no owner id to use.
-- ---------------------------------------------------------------------------
drop policy if exists "owners upload to own folder" on storage.objects;
drop policy if exists "owners read own files" on storage.objects;
drop policy if exists "owners delete own files" on storage.objects;

create policy "open upload to documents bucket"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'documents');

create policy "open read documents bucket"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'documents');

create policy "open delete documents bucket"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'documents');
