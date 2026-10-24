-- Périmètre par organisation (20261024160841) : l'auteur et le dernier
-- modificateur d'un courrier le voient aussi.
--
-- PostgREST écrit toujours avec un RETURNING interne : la NOUVELLE ligne doit
-- rester lisible par celui qui écrit. Sans cette règle, tout geste qui fait
-- sortir un courrier du périmètre de son auteur était refusé (« new row
-- violates row-level security policy ») : le viseur qui vise (la réponse passe
-- à la signature, il n'y est plus désigné), l'agent qui transfère vers une
-- autre organisation, le gestionnaire qui crée un sortant d'une autre
-- organisation. `updated_by` est posé par trigger AVANT le contrôle RLS : celui
-- qui vient d'agir garde la vue jusqu'à ce que quelqu'un d'autre y touche.

CREATE OR REPLACE FUNCTION public.courier_in_scope(_org uuid, _id uuid, _socle_org uuid, _state uuid, _metadata jsonb)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _socle_org IS NULL
    OR public.can_access_mailroom(_org)
    OR EXISTS (SELECT 1 FROM public.couriers x
               WHERE x.id = _id AND (x.created_by = auth.uid() OR x.updated_by = auth.uid()))
    OR EXISTS (SELECT 1 FROM public.socle_organization_members m
               WHERE m.user_id = auth.uid() AND m.socle_organization_id = _socle_org)
    OR public.is_designated_on_courier(_socle_org, _state, _metadata)
    OR public.is_designated_on_reply_of(_id);
$$;

DROP POLICY IF EXISTS auth_select ON public.couriers;
CREATE POLICY auth_select ON public.couriers
  FOR SELECT TO authenticated
  USING (
    (
      (SELECT public.is_superadmin((SELECT auth.uid())))
      OR organization_id IN (SELECT public.current_user_orgs())
    )
    AND deleted_at IS NULL
    AND (
      NOT is_confidential
      OR public.can_read_confidential_courier(organization_id, id, socle_organization_id, workflow_state_id, metadata)
    )
    AND (
      socle_organization_id IS NULL
      OR created_by = (SELECT auth.uid())
      OR updated_by = (SELECT auth.uid())
      OR (SELECT public.is_superadmin((SELECT auth.uid())))
      OR organization_id IN (SELECT public.current_user_wide_orgs())
      OR socle_organization_id IN (SELECT public.current_user_socle_orgs())
      OR public.is_designated_on_courier(socle_organization_id, workflow_state_id, metadata)
      OR public.is_designated_on_reply_of(id)
    )
  );

-- RPC de liste : même ajout dans le bloc injecté par 20261024160841.
DO $$
DECLARE
  fn text;
  def text;
  old_head constant text := '/* perimetre_organisation */ c.socle_organization_id IS NULL';
  new_head constant text := '/* perimetre_organisation v2 */ c.socle_organization_id IS NULL
      OR c.created_by = auth.uid() OR c.updated_by = auth.uid()';
BEGIN
  FOREACH fn IN ARRAY ARRAY['search_couriers', 'outbound_couriers', 'contact_couriers'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn;
    IF position('perimetre_organisation v2' in def) > 0 THEN
      CONTINUE;
    END IF;
    IF position(old_head in def) = 0 THEN
      RAISE EXCEPTION 'perimetre_auteur : bloc de périmètre introuvable dans %', fn;
    END IF;
    EXECUTE replace(def, old_head, new_head);
  END LOOP;
END $$;
