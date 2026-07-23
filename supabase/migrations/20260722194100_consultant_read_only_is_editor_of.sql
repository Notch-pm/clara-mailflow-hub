-- Consultant en lecture seule : introduit un niveau d'autorisation intermédiaire
-- `is_editor_of` (membre actif dont le rôle ≠ 'consultant', superadmin inclus) et
-- bascule TOUTES les écritures opérationnelles (INSERT/UPDATE/DELETE) de
-- `is_member_of` vers `is_editor_of`. Les SELECT restent sur `is_member_of` :
-- le consultant continue de tout LIRE, mais ne peut plus RIEN écrire.
--
-- Idempotent (CREATE OR REPLACE / DROP POLICY IF EXISTS). Noms de policies et
-- prédicats calqués sur l'état réel de la base (pg_policies), pas sur les fichiers.
-- Voir docs/permissions.md (matrice cible) et docs/database-rls.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper : is_editor_of — clone exact de is_member_of + rôle ≠ 'consultant'.
--    `IS DISTINCT FROM` : les membres au rôle NULL / legacy 'member' gardent
--    l'écriture ; seul un rôle explicitement 'consultant' est exclu.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_editor_of(_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users
      WHERE user_id = auth.uid()
        AND organization_id = _org
        AND COALESCE(is_active, true) = true
        AND role IS DISTINCT FROM 'consultant'
    );
$function$;

-- Postgres accorde EXECUTE à PUBLIC par défaut à la création : on le révoque pour
-- calquer exactement is_member_of (ni anon ni public), puis on accorde nominativement.
REVOKE EXECUTE ON FUNCTION public.is_editor_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_editor_of(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tables opérationnelles au patron standard auth_insert/auth_update/auth_delete.
--    SELECT (auth_select) et service_role_full LAISSÉS INTACTS.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  ops text[] := ARRAY[
    'couriers', 'courier_events', 'courier_notes', 'courier_participants',
    'courier_links', 'action_tickets', 'courier_documents', 'courier_analyses',
    'courier_document_extracts', 'courier_sequences', 'roles'
  ];
BEGIN
  FOREACH t IN ARRAY ops LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_insert ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_insert ON public.%I FOR INSERT TO authenticated '
      || 'WITH CHECK (public.is_editor_of(organization_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS auth_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_update ON public.%I FOR UPDATE TO authenticated '
      || 'USING (public.is_editor_of(organization_id)) '
      || 'WITH CHECK (public.is_editor_of(organization_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS auth_delete ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY auth_delete ON public.%I FOR DELETE TO authenticated '
      || 'USING (public.is_editor_of(organization_id))', t);
  END LOOP;
END $$;

-- courier_relations : seulement INSERT + DELETE en base (pas d'auth_update).
DROP POLICY IF EXISTS auth_insert ON public.courier_relations;
CREATE POLICY auth_insert ON public.courier_relations FOR INSERT TO authenticated
  WITH CHECK (public.is_editor_of(organization_id));
DROP POLICY IF EXISTS auth_delete ON public.courier_relations;
CREATE POLICY auth_delete ON public.courier_relations FOR DELETE TO authenticated
  USING (public.is_editor_of(organization_id));

-- notifications : INSERT (une notification est un effet de bord d'une action ;
-- un consultant n'en produit pas). Le marquage lu/non-lu (UPDATE) reste régi par
-- sa policy user-scoped (user_id = auth.uid()), non touchée ici.
DROP POLICY IF EXISTS notifications_insert_org_member ON public.notifications;
CREATE POLICY notifications_insert_org_member ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_editor_of(organization_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Storage bucket clara-documents : écritures → is_editor_of.
--    Le 1er segment du chemin est l'UUID de l'organisation (cast direct, confirmé
--    en base). SELECT (clara_documents_select_org_member) laissé sur is_member_of.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS clara_documents_insert_org_member ON storage.objects;
CREATE POLICY clara_documents_insert_org_member ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clara-documents'
    AND public.is_editor_of(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS clara_documents_update_org_member ON storage.objects;
CREATE POLICY clara_documents_update_org_member ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clara-documents'
    AND public.is_editor_of(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'clara-documents'
    AND public.is_editor_of(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS clara_documents_delete_org_member ON storage.objects;
CREATE POLICY clara_documents_delete_org_member ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'clara-documents'
    AND public.is_editor_of(((storage.foldername(name))[1])::uuid)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC d'enfilement d'analyse IA (SECURITY DEFINER, bypasse la RLS) :
--    re-vérifier is_editor_of pour interdire la relance d'analyse au consultant.
--    Corps identique à la version en base, seul le check de rôle change.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_courier_analysis(p_courier_id uuid, p_kind text DEFAULT 'full'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_job_id uuid;
BEGIN
  SELECT c.organization_id INTO v_org_id
  FROM couriers c
  WHERE c.id = p_courier_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Courrier introuvable';
  END IF;

  IF NOT public.is_editor_of(v_org_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- ON CONFLICT ne sait pas viser un index UNIQUE partiel sans en répéter le
  -- prédicat ; on l'écrit explicitement pour rendre l'appel idempotent.
  INSERT INTO courier_analysis_jobs (organization_id, courier_id, kind, requested_by)
  VALUES (v_org_id, p_courier_id, p_kind, auth.uid())
  ON CONFLICT (courier_id) WHERE status IN ('pending', 'running')
  DO NOTHING
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$function$;
