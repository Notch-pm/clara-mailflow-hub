ALTER TABLE public.organization_users
ADD COLUMN IF NOT EXISTS is_signataire boolean NOT NULL DEFAULT false;