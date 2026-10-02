-- « Boîte aux lettres » devient « À instruire » : le motif de refus levé par la
-- base suit le libellé de l'écran, mot pour mot (`IN_MAILBOX_REASON` dans
-- `supabase/functions/_shared/courierCreationGuard.ts`, vérifié par
-- `src/test/courier/courier-creation-guard.test.ts`). Seul ce texte change ;
-- le reste reprend la définition en production.

CREATE OR REPLACE FUNCTION public.courier_creation_block_reason(p_courier_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN c.id IS NULL THEN NULL  -- la clé étrangère refusera d'elle-même
    WHEN c.deleted_at IS NOT NULL THEN
      'Ce courrier est dans la corbeille : restaurez-le avant de créer une action ou une réponse.'
    WHEN c.socle_organization_id IS NULL THEN
      'Ce courrier n''a pas d''organisation gestionnaire : désignez-la avant de créer une action ou une réponse.'
    -- `is_initial` NULL compte comme « pas initial », comme la page « À
    -- instruire » (filtre `is_initial = true`) ; un état introuvable, comme aucun.
    WHEN c.workflow_state_id IS NULL OR ws.id IS NULL OR ws.is_initial IS TRUE THEN
      'Ce courrier est encore dans « À instruire » : faites-le avancer dans son workflow avant de créer une action ou une réponse.'
  END
  FROM (SELECT p_courier_id AS id) k
  LEFT JOIN public.couriers c ON c.id = k.id
  LEFT JOIN public.workflow_states ws ON ws.id = c.workflow_state_id;
$function$;
