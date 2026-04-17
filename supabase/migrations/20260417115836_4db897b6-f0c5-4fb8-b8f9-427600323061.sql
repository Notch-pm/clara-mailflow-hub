CREATE TABLE public.imap_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  host text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 993,
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  use_tls boolean NOT NULL DEFAULT true,
  folder text NOT NULL DEFAULT 'INBOX',
  auto_fetch boolean NOT NULL DEFAULT false,
  last_fetch_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.imap_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_admin_read_imap"
ON public.imap_settings FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM organization_users
  WHERE user_id = auth.uid()
    AND organization_id = imap_settings.organization_id
    AND role IN ('admin','administrateur')
));

CREATE POLICY "org_admin_write_imap"
ON public.imap_settings FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM organization_users
  WHERE user_id = auth.uid()
    AND organization_id = imap_settings.organization_id
    AND role IN ('admin','administrateur')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM organization_users
  WHERE user_id = auth.uid()
    AND organization_id = imap_settings.organization_id
    AND role IN ('admin','administrateur')
));

CREATE POLICY "superadmin_all_imap"
ON public.imap_settings FOR ALL TO authenticated
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

CREATE POLICY "service_role_full_imap"
ON public.imap_settings FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER imap_settings_set_updated_at
BEFORE UPDATE ON public.imap_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
