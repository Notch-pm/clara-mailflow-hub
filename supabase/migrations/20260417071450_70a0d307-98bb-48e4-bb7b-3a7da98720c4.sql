
CREATE TABLE public.courier_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  color varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (organization_id, name)
);

ALTER TABLE public.courier_tags ENABLE ROW LEVEL SECURITY;

-- All authenticated members of the org can read
CREATE POLICY auth_select ON public.courier_tags
  FOR SELECT TO authenticated
  USING (organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid));

-- Only admins can mutate
CREATE POLICY admin_insert ON public.courier_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = courier_tags.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE POLICY admin_update ON public.courier_tags
  FOR UPDATE TO authenticated
  USING (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = courier_tags.organization_id
        AND ou.role = 'administrateur'
    )
  )
  WITH CHECK (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = courier_tags.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE POLICY admin_delete ON public.courier_tags
  FOR DELETE TO authenticated
  USING (
    organization_id = (((current_setting('request.headers', true))::json ->> 'x-org-id')::uuid)
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = courier_tags.organization_id
        AND ou.role = 'administrateur'
    )
  );

CREATE INDEX idx_courier_tags_org ON public.courier_tags(organization_id);
