-- SecureDoc — Supabase schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  title        text not null,
  storage_path text not null,
  file_size    bigint not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.share_links (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents (id) on delete cascade,
  token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  allowed_email text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.view_sessions (
  id            uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links (id) on delete cascade,
  document_id   uuid not null references public.documents (id) on delete cascade,
  viewer_email  text not null,
  ip_address    text,
  user_agent    text,
  opened_at     timestamptz not null default now(),
  total_seconds integer not null default 0
);

create table if not exists public.page_views (
  session_id    uuid not null references public.view_sessions (id) on delete cascade,
  page_number   integer not null,
  seconds_spent integer not null default 0,
  primary key (session_id, page_number)
);

create index if not exists idx_documents_owner on public.documents (owner_id);
create index if not exists idx_share_links_document on public.share_links (document_id);
create index if not exists idx_view_sessions_document on public.view_sessions (document_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- Owners can manage their own documents and share links, and can READ
-- analytics. Viewer-side writes (sessions, page views) happen only through
-- edge functions using the service role key, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.documents     enable row level security;
alter table public.share_links   enable row level security;
alter table public.view_sessions enable row level security;
alter table public.page_views    enable row level security;

create policy "owners manage own documents"
  on public.documents for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "owners manage own share links"
  on public.share_links for all
  using (exists (
    select 1 from public.documents d
    where d.id = share_links.document_id and d.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.documents d
    where d.id = share_links.document_id and d.owner_id = auth.uid()
  ));

create policy "owners read own view sessions"
  on public.view_sessions for select
  using (exists (
    select 1 from public.documents d
    where d.id = view_sessions.document_id and d.owner_id = auth.uid()
  ));

create policy "owners read own page views"
  on public.page_views for select
  using (exists (
    select 1
    from public.view_sessions s
    join public.documents d on d.id = s.document_id
    where s.id = page_views.session_id and d.owner_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Storage — private bucket. Files live at {owner_id}/{uuid}.pdf.
-- No public access. Viewers never touch storage directly; the
-- serve-document edge function reads with the service role and returns
-- a watermarked copy.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "owners upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "owners delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
