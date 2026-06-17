-- Formulaire portail citoyen : permet d'intégrer un formulaire de contact sur un site tiers
-- via <iframe>. Chaque soumission crée un courrier inbound channel=portal dans Clara.

-- ─── Table portal_forms ────────────────────────────────────────────────────────
CREATE TABLE public.portal_forms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_id       uuid REFERENCES public.services(id) ON DELETE SET NULL,
  token            text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  name             text NOT NULL,
  description      text,
  is_active        boolean NOT NULL DEFAULT true,
  allowed_origins  text[],
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_forms_org ON public.portal_forms(organization_id);
CREATE INDEX idx_portal_forms_token ON public.portal_forms(token);

ALTER TABLE public.portal_forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_select ON public.portal_forms FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

CREATE POLICY auth_insert ON public.portal_forms FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));

CREATE POLICY auth_update ON public.portal_forms FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

CREATE POLICY auth_delete ON public.portal_forms FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- service_role pour l'edge function (soumissions anonymes)
CREATE POLICY service_role_full ON public.portal_forms FOR ALL
  USING (auth.role() = 'service_role');

CREATE TRIGGER portal_forms_set_updated_at
  BEFORE UPDATE ON public.portal_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Table portal_form_submissions (rate-limiting) ─────────────────────────────
CREATE TABLE public.portal_form_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_form_id  uuid NOT NULL REFERENCES public.portal_forms(id) ON DELETE CASCADE,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_form_submissions_form_time
  ON public.portal_form_submissions(portal_form_id, created_at);

-- Nettoyage automatique : supprime les entrées de plus de 1 heure
-- via une politique d'expiration légère (géré côté edge function au moment de l'insert)
