CREATE TABLE public.service_signatories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  signatory_id uuid NOT NULL REFERENCES public.signatories(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (service_id, signatory_id)
);

CREATE INDEX idx_service_signatories_service ON public.service_signatories(service_id);
CREATE INDEX idx_service_signatories_signatory ON public.service_signatories(signatory_id);
CREATE INDEX idx_service_signatories_org ON public.service_signatories(organization_id);

ALTER TABLE public.service_signatories ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.service_signatories FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_insert ON public.service_signatories FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_update ON public.service_signatories FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid)
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_delete ON public.service_signatories FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);