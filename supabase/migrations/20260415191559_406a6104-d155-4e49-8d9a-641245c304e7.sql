
-- Add branding columns to organizations
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS primary_color text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS secondary_color text;

-- Add superadmin flag to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

-- Create smtp_settings table
CREATE TABLE public.smtp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
  host text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 587,
  username text NOT NULL DEFAULT '',
  password text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  from_name text NOT NULL DEFAULT '',
  use_tls boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for smtp_settings
ALTER TABLE public.smtp_settings ENABLE ROW LEVEL SECURITY;

-- Superadmins can manage all smtp_settings
CREATE POLICY "superadmin_all_smtp" ON public.smtp_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  );

-- Org admins can view their own smtp_settings
CREATE POLICY "org_admin_read_smtp" ON public.smtp_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users
      WHERE user_id = auth.uid()
        AND organization_id = smtp_settings.organization_id
        AND role = 'admin'
    )
  );

-- Superadmins can manage all organizations (for branding updates)
CREATE POLICY "superadmin_update_orgs" ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  );

-- Superadmins can read all organizations
CREATE POLICY "superadmin_select_orgs" ON public.organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  );

-- Superadmins can insert organizations
CREATE POLICY "superadmin_insert_orgs" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  );

-- Superadmins can delete organizations
CREATE POLICY "superadmin_delete_orgs" ON public.organizations
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_superadmin = true)
  );

-- Updated_at trigger for smtp_settings
CREATE TRIGGER set_smtp_updated_at
  BEFORE UPDATE ON public.smtp_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
