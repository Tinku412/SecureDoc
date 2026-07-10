-- SecureDoc migration v2
-- Run this in the Supabase SQL editor after schema.sql.

-- Allow documents to have download disabled.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS download_allowed boolean NOT NULL DEFAULT true;

-- Per-link: public access (no email required) and optional expiry.
ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;

-- allowed_email may be NULL for public links.
ALTER TABLE public.share_links
  ALTER COLUMN allowed_email DROP NOT NULL;

-- Enforce that every link is either public or has an allowed_email.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_email_or_public'
  ) THEN
    ALTER TABLE public.share_links
      ADD CONSTRAINT check_email_or_public
      CHECK (is_public = true OR allowed_email IS NOT NULL);
  END IF;
END $$;
