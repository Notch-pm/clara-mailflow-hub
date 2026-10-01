-- Proposition du service instructeur par l'analyse IA.
--
-- 1. `socle_organizations.public_description` : descriptif « informations usager »
--    de chaque organisation, en miroir du Socle (`GET /v1/portal/organizations`).
--    Écrit par `sync-socle-referentiel` seule ; NULL pour un service interne
--    (le Socle ne publie rien pour eux). Sert de catalogue au modèle.
-- 2. `courier_analyses.suggested_socle_organization_id` + `suggested_service_reason` :
--    la proposition par IDENTIFIANT, avec sa justification. `suggested_service_name`
--    reste écrit (nom dérivé de l'id) pour l'existant.
--
-- Rejouable : IF NOT EXISTS.

ALTER TABLE public.socle_organizations
  ADD COLUMN IF NOT EXISTS public_description text;

COMMENT ON COLUMN public.socle_organizations.public_description IS
  'Descriptif « informations usager » du Socle (texte brut, borné). Miroir écrit par la sync ; NULL pour un service interne.';

ALTER TABLE public.courier_analyses
  ADD COLUMN IF NOT EXISTS suggested_socle_organization_id uuid
    REFERENCES public.socle_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_service_reason text;

COMMENT ON COLUMN public.courier_analyses.suggested_socle_organization_id IS
  'Organisation gestionnaire proposée par l''IA (revalidée contre le catalogue). Une proposition : l''agent l''applique ou non.';
COMMENT ON COLUMN public.courier_analyses.suggested_service_reason IS
  'Justification en une phrase de la proposition de service.';

CREATE INDEX IF NOT EXISTS courier_analyses_suggested_socle_org_idx
  ON public.courier_analyses (suggested_socle_organization_id)
  WHERE suggested_socle_organization_id IS NOT NULL;
