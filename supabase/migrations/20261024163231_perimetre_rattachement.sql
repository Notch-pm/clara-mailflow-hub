-- Périmètre par organisation : être RATTACHÉ à une organisation Socle comme
-- membre, viseur ou signataire donne la vue sur ses courriers.
--
-- Le signataire de la Direction n'y est rattaché que par
-- `socle_organization_signatories` : sans cette règle, il ne voyait plus une
-- réponse arrivée à l'étape de signature qui ne le nommait pas (brouillon sans
-- `signatory_id`) — donc ne pouvait plus la signer. Même chose pour le viseur
-- entre deux étapes. Ces rattachements sont paramétrés par un administrateur
-- dans la configuration de l'organisation.
--
-- `current_user_socle_orgs()` sert à la policy de `couriers` et aux RPC de
-- liste ; `courier_in_scope` (can_read_courier, Storage) s'y aligne.

CREATE OR REPLACE FUNCTION public.current_user_socle_orgs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT socle_organization_id FROM public.socle_organization_members WHERE user_id = auth.uid()
  UNION
  SELECT socle_organization_id FROM public.socle_organization_viseurs WHERE user_id = auth.uid()
  UNION
  SELECT so.socle_organization_id
  FROM public.socle_organization_signatories so
  JOIN public.signatories s ON s.id = so.signatory_id
  WHERE s.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.courier_in_scope(_org uuid, _id uuid, _socle_org uuid, _state uuid, _metadata jsonb)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _socle_org IS NULL
    OR public.can_access_mailroom(_org)
    OR EXISTS (SELECT 1 FROM public.couriers x
               WHERE x.id = _id AND (x.created_by = auth.uid() OR x.updated_by = auth.uid()))
    OR _socle_org IN (SELECT public.current_user_socle_orgs())
    OR public.is_designated_on_courier(_socle_org, _state, _metadata)
    OR public.is_designated_on_reply_of(_id);
$$;
