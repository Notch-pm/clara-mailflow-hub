-- Junction table: associate organization users to services
CREATE TABLE public.service_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, user_id)
);

CREATE INDEX idx_service_members_service ON public.service_members(service_id);
CREATE INDEX idx_service_members_user ON public.service_members(user_id);
CREATE INDEX idx_service_members_org ON public.service_members(organization_id);

ALTER TABLE public.service_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_members_select" ON public.service_members
  FOR SELECT TO authenticated
  USING (
    organization_id = (
      (current_setting('request.headers', true)::json ->> 'x-org-id')::uuid
    )
  );

CREATE POLICY "service_members_insert" ON public.service_members
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (
      (current_setting('request.headers', true)::json ->> 'x-org-id')::uuid
    )
  );

CREATE POLICY "service_members_delete" ON public.service_members
  FOR DELETE TO authenticated
  USING (
    organization_id = (
      (current_setting('request.headers', true)::json ->> 'x-org-id')::uuid
    )
  );
