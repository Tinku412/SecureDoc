-- SecureDoc migration v9
-- Run in the Supabase SQL editor after migration_v8.sql.
--
-- Adds support for "URL" items alongside PDF documents: instead of
-- uploading a file, the owner can point a link at any external URL
-- (a blog post, a website, etc). URL links skip all access-control /
-- watermarking machinery entirely — they only carry the CTA overlay
-- settings — and viewers never see an email/verification gate for them.

alter table public.documents alter column storage_path drop not null;

alter table public.documents add column if not exists type text not null default 'pdf';
alter table public.documents add column if not exists source_url text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_type_check') then
    alter table public.documents
      add constraint documents_type_check check (type in ('pdf', 'url'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_type_source_check') then
    alter table public.documents
      add constraint documents_type_source_check
      check (
        (type = 'pdf' and storage_path is not null) or
        (type = 'url' and source_url is not null)
      );
  end if;
end $$;
