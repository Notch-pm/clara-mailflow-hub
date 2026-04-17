-- Table des démarches administratives (procédures)
CREATE TABLE public.procedures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  description text,
  icon text,
  color varchar,
  external_reference_id varchar,
  external_source varchar,
  is_displayed boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX procedures_external_unique
  ON public.procedures (organization_id, external_source, external_reference_id)
  WHERE external_source IS NOT NULL AND external_reference_id IS NOT NULL;

CREATE INDEX procedures_org_idx ON public.procedures (organization_id);

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;

-- Lecture pour tous les membres de l'organisation
CREATE POLICY auth_select ON public.procedures
  FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers'::text, true))::json ->> 'x-org-id')::uuid);

-- Écriture réservée aux administrateurs de l'organisation
CREATE POLICY admin_insert ON public.procedures
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = ((current_setting('request.headers'::text, true))::json ->> 'x-org-id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role::text = 'administrateur'
    )
  );

CREATE POLICY admin_update ON public.procedures
  FOR UPDATE TO authenticated
  USING (
    organization_id = ((current_setting('request.headers'::text, true))::json ->> 'x-org-id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role::text = 'administrateur'
    )
  )
  WITH CHECK (
    organization_id = ((current_setting('request.headers'::text, true))::json ->> 'x-org-id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role::text = 'administrateur'
    )
  );

CREATE POLICY admin_delete ON public.procedures
  FOR DELETE TO authenticated
  USING (
    organization_id = ((current_setting('request.headers'::text, true))::json ->> 'x-org-id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.organization_id = procedures.organization_id
        AND ou.role::text = 'administrateur'
    )
  );

-- Service role bypass pour cron/edge functions
CREATE POLICY service_role_full_access ON public.procedures
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER procedures_set_updated_at
  BEFORE UPDATE ON public.procedures
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();