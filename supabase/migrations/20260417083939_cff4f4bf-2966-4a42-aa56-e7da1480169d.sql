CREATE TABLE public.courier_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id UUID NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_courier_notes_courier_id ON public.courier_notes(courier_id);
CREATE INDEX idx_courier_notes_org_id ON public.courier_notes(organization_id);

ALTER TABLE public.courier_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON public.courier_notes
  FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_insert" ON public.courier_notes
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_update" ON public.courier_notes
  FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid)
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "auth_delete" ON public.courier_notes
  FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY "org_isolation" ON public.courier_notes
  FOR ALL TO public
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

CREATE TRIGGER set_courier_notes_updated_at
  BEFORE UPDATE ON public.courier_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();