ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS reply_template_html text,
ADD COLUMN IF NOT EXISTS reply_template_design jsonb;
