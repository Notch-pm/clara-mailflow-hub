
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  email varchar,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, name)
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.services
  FOR SELECT TO authenticated
  USING (organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid));

CREATE POLICY admin_insert ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = services.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE POLICY admin_update ON public.services
  FOR UPDATE TO authenticated
  USING (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = services.organization_id
        AND ou.role = 'administrateur'
    )
  )
  WITH CHECK (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = services.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE POLICY admin_delete ON public.services
  FOR DELETE TO authenticated
  USING (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = services.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_services_org ON public.services(organization_id);
CREATE INDEX idx_services_workflow ON public.services(workflow_id);
