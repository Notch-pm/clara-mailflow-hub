-- Intégration Partenaires, lot L2 (docs/partenaires-integration.md §3, §8).
--
-- Verrou de la config partenaire : la policy actuelle (is_admin_of, ALL) permet à
-- un admin de tenant de lire/écrire la config et ses SECRETS par appel direct,
-- alors que le besoin est « superadmin uniquement » (l'UI n'est déjà montée que
-- sur la route superadmin). On resserre écritures ET lecture à is_superadmin,
-- et on expose un RPC de statut NON sensible (configured/is_active, sans secret)
-- pour que le produit sache si l'interface est active (grisage, boutons).
--
-- Pré-vérifié en base : 0 ligne organization_id NULL (NOT NULL sûr), pas de
-- contrainte d'unicité (org, provider), policies actuelles =
-- org_admin_manage_integrations + service_role_full_access (conservée).
-- Idempotent.

-- 1. Contraintes : une instance de connexion par (tenant, partenaire).
ALTER TABLE public.organization_integrations
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_integrations_org_provider_key'
  ) THEN
    ALTER TABLE public.organization_integrations
      ADD CONSTRAINT organization_integrations_org_provider_key
      UNIQUE (organization_id, provider);
  END IF;
END $$;

-- 2. Verrou RLS : superadmin uniquement (service_role_full_access reste en place
--    pour les edge functions, qui lisent la config en service_role).
DROP POLICY IF EXISTS org_admin_manage_integrations ON public.organization_integrations;
DROP POLICY IF EXISTS integrations_superadmin_all ON public.organization_integrations;
CREATE POLICY integrations_superadmin_all ON public.organization_integrations
  FOR ALL TO authenticated
  USING (public.is_superadmin((select auth.uid())))
  WITH CHECK (public.is_superadmin((select auth.uid())));

-- 3. Statut non sensible pour le produit : tout membre de l'org peut savoir si
--    une interface partenaire est configurée et active — jamais les secrets.
CREATE OR REPLACE FUNCTION public.partner_integration_status(
  p_organization_id uuid,
  p_provider text DEFAULT 'arpege'
)
RETURNS TABLE(configured boolean, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (oi.id IS NOT NULL) AS configured,
    COALESCE(oi.is_active, false) AS is_active
  FROM (SELECT 1) AS one
  LEFT JOIN public.organization_integrations oi
    ON oi.organization_id = p_organization_id
   AND oi.provider = p_provider
  WHERE public.is_member_of(p_organization_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.partner_integration_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_integration_status(uuid, text) TO authenticated, service_role;
