-- Périmètre par organisation Socle appliqué EN BASE (jusqu'ici UI-only,
-- `useUserServiceFilter`) : un membre lisait tout le tenant par URL directe ou
-- appel API, pièces jointes Storage comprises (E2E securite/intra-tenant).
--
-- Règle (docs/permissions.md) — un courrier est lisible si :
--   - il n'a pas d'organisation (non assigné, « Courrier entrant ») ;
--   - ou le lecteur est superadmin, administrateur du tenant, ou gestionnaire
--     courrier (`can_access_mailroom` : il suit et relance les courriers routés) ;
--   - ou le lecteur est membre de l'organisation Socle du courrier
--     (`socle_organization_members`, correspondance exacte comme l'UI) ;
--   - ou il est désigné sur le courrier ou sur l'une de ses réponses (viseur,
--     signataire — parapheur), comme pour les courriers confidentiels.
-- Les écritures (INSERT/UPDATE) restent `is_editor_of` : transférer un
-- courrier hors de son périmètre doit rester possible (la ligne cesse alors
-- d'être lisible ; côté client, l'UPDATE ne la relit pas).

-- Ensembles calculés une fois par requête (initplan), pas par ligne.
CREATE OR REPLACE FUNCTION public.current_user_socle_orgs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT socle_organization_id FROM public.socle_organization_members
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_wide_orgs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT organization_id FROM public.organization_users
  WHERE user_id = auth.uid()
    AND COALESCE(is_active, true) = true
    AND (role IN ('admin', 'administrateur') OR is_service_courrier = true);
$$;

-- Désigné sur une réponse de ce courrier (le parapheur ouvre le courrier d'origine).
CREATE OR REPLACE FUNCTION public.is_designated_on_reply_of(_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.couriers r
    WHERE r.parent_courier_id = _id AND r.deleted_at IS NULL
      AND public.is_designated_on_courier(r.socle_organization_id, r.workflow_state_id, r.metadata)
  );
$$;

-- Même règle, pour une ligne donnée (can_read_courier, Storage).
CREATE OR REPLACE FUNCTION public.courier_in_scope(_org uuid, _id uuid, _socle_org uuid, _state uuid, _metadata jsonb)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _socle_org IS NULL
    OR public.can_access_mailroom(_org)  -- administrateur, superadmin, gestionnaire courrier
    OR EXISTS (SELECT 1 FROM public.socle_organization_members m
               WHERE m.user_id = auth.uid() AND m.socle_organization_id = _socle_org)
    OR public.is_designated_on_courier(_socle_org, _state, _metadata)
    OR public.is_designated_on_reply_of(_id);
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_socle_orgs() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_wide_orgs() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_designated_on_reply_of(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.courier_in_scope(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_socle_orgs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_wide_orgs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_designated_on_reply_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_in_scope(uuid, uuid, uuid, uuid, jsonb) TO authenticated, service_role;

-- couriers : la policy de 20261014170000 + le périmètre.
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
      OR (SELECT public.is_superadmin((SELECT auth.uid())))
      OR organization_id IN (SELECT public.current_user_wide_orgs())
      OR socle_organization_id IN (SELECT public.current_user_socle_orgs())
      OR public.is_designated_on_courier(socle_organization_id, workflow_state_id, metadata)
      OR public.is_designated_on_reply_of(id)
    )
  );

-- Toutes les tables filles (événements, notes, participants, pièces, analyses,
-- liens, visas, tickets…) lisent à travers can_read_courier.
CREATE OR REPLACE FUNCTION public.can_read_courier(p_courier_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT public.is_member_of(c.organization_id)
    AND (NOT c.is_confidential OR public.can_read_confidential_courier(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata))
    AND public.courier_in_scope(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata)
    FROM public.couriers c WHERE c.id = p_courier_id), false);
$$;

-- Storage : un fichier rattaché à un courrier n'est lisible que si le courrier
-- l'est. Fichiers hors courrier (modèles, etc.) : règle du tenant inchangée.
CREATE INDEX IF NOT EXISTS idx_courier_documents_storage_key ON public.courier_documents (storage_key);

CREATE OR REPLACE FUNCTION public.storage_object_readable(_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  -- Deux rangements coexistent : <org>/couriers/<courrier>/… et <org>/<courrier>/….
  WITH folder AS (
    SELECT CASE WHEN f[2] = 'couriers' THEN f[3] ELSE f[2] END AS seg
    FROM (SELECT storage.foldername(_name) AS f) x
  ), by_path AS (
    SELECT c.id FROM folder, public.couriers c
    WHERE folder.seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND c.id = folder.seg::uuid
  )
  SELECT COALESCE(
    (SELECT bool_and(public.can_read_courier(d.courier_id))
       FROM public.courier_documents d WHERE d.storage_key = _name),
    (SELECT public.can_read_courier(id) FROM by_path),
    true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.storage_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_object_readable(text) TO authenticated, service_role;

DROP POLICY IF EXISTS clara_documents_select_org_member ON storage.objects;
CREATE POLICY clara_documents_select_org_member ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clara-documents'
    AND public.is_member_of(((storage.foldername(name))[1])::uuid)
    AND public.storage_object_readable(name)
  );

-- Pourquoi une fiche ne s'ouvre pas : on distingue désormais « hors de mes
-- organisations » de « confidentiel » (sans rien révéler du courrier).
CREATE OR REPLACE FUNCTION public.courier_access(p_courier_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT CASE
      WHEN c.deleted_at IS NOT NULL OR NOT public.is_member_of(c.organization_id) THEN 'missing'
      WHEN public.can_read_courier(c.id) THEN 'ok'
      WHEN NOT public.courier_in_scope(c.organization_id, c.id, c.socle_organization_id, c.workflow_state_id, c.metadata) THEN 'out_of_scope'
      ELSE 'confidential' END
    FROM public.couriers c WHERE c.id = p_courier_id), 'missing');
$$;

-- RPC de liste en SECURITY DEFINER (elles contournent la RLS) : même périmètre,
-- injecté après leur garde `is_member_of`. Rejouable (marqueur) ; échoue si le
-- point d'ancrage a changé plutôt que de laisser une liste non filtrée.
-- mailroom_couriers / trashed_couriers : réservées au service courrier et aux
-- administrateurs (périmètre = tout le tenant), inchangées.
DO $$
DECLARE
  fn text;
  def text;
  anchor constant text := 'AND public.is_member_of(p_organization_id)';
  scope constant text := 'AND public.is_member_of(p_organization_id)
    AND (/* perimetre_organisation */ c.socle_organization_id IS NULL
      OR (SELECT public.can_access_mailroom(p_organization_id))
      OR c.socle_organization_id IN (SELECT public.current_user_socle_orgs())
      OR public.is_designated_on_courier(c.socle_organization_id, c.workflow_state_id, c.metadata)
      OR public.is_designated_on_reply_of(c.id))';
BEGIN
  FOREACH fn IN ARRAY ARRAY['search_couriers', 'outbound_couriers', 'contact_couriers'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn;
    IF position('perimetre_organisation' in def) > 0 THEN
      CONTINUE;
    END IF;
    IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
      RAISE EXCEPTION 'perimetre_organisation : ancrage introuvable ou ambigu dans %', fn;
    END IF;
    EXECUTE replace(def, anchor, scope);
  END LOOP;
END $$;
