
-- Table action_tickets : tickets d'action liés à un courrier et à une démarche
CREATE TABLE public.action_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  procedure_id uuid NOT NULL REFERENCES public.procedures(id) ON DELETE RESTRICT,
  description text,
  status text NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_tickets_courier ON public.action_tickets(courier_id);
CREATE INDEX idx_action_tickets_org ON public.action_tickets(organization_id);
CREATE INDEX idx_action_tickets_procedure ON public.action_tickets(procedure_id);

ALTER TABLE public.action_tickets ENABLE ROW LEVEL SECURITY;

-- Pattern RLS aligné sur les autres tables courrier (x-org-id header)
CREATE POLICY auth_select ON public.action_tickets
  FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_insert ON public.action_tickets
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_update ON public.action_tickets
  FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid)
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_delete ON public.action_tickets
  FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

-- Empêche le changement du courrier rattaché à un ticket existant
CREATE OR REPLACE FUNCTION public.action_tickets_prevent_courier_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.courier_id IS DISTINCT FROM OLD.courier_id THEN
    RAISE EXCEPTION 'Le courrier d''un ticket ne peut pas être modifié';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_action_tickets_prevent_courier_change
  BEFORE UPDATE ON public.action_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.action_tickets_prevent_courier_change();

-- Trigger updated_at (réutilise set_updated_at existant)
CREATE TRIGGER trg_action_tickets_updated_at
  BEFORE UPDATE ON public.action_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
