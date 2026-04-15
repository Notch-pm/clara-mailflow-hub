
CREATE TABLE public.organization_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,
  client_id text,
  client_secret text,
  access_token text,
  api_base_url text,
  api_url_ticketingapp text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.organization_integrations
  FOR ALL TO authenticated
  USING (organization_id::text = current_setting('request.headers', true)::json->>'x-org-id')
  WITH CHECK (organization_id::text = current_setting('request.headers', true)::json->>'x-org-id');

CREATE POLICY "service_role_full_access" ON public.organization_integrations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE UNIQUE INDEX idx_org_integration_provider ON public.organization_integrations (organization_id, provider);
