-- Consolidation RLS — advisors performance du 2026-07-12 (dette P1.2 + P1.3).
--   • auth_rls_initplan (32 policies) : auth.uid() / auth.role() / current_setting()
--     ré-évalués par ligne → wrappés en initplan `(select ...)` ou remplacés par
--     les helpers is_member_of / is_admin_of (STABLE SECURITY DEFINER).
--   • multiple_permissive_policies (29 cas) : une seule policy permissive par
--     (table, rôle, action) — fusion par OR, ou suppression des policies
--     superadmin redondantes (is_member_of / is_admin_of incluent le superadmin).
-- Prolonge 20260522150000_cleanup_rls_anomalies : policies sur helpers, sans
-- EXISTS inline ni dépendance au header x-org-id quand un équivalent existe.
-- Validée par la suite test:integration (54 tests RLS).

-- ─── 1. service_role_full déclarées sans TO (= PUBLIC) sur 8 tables ─────────
-- `USING (auth.role() = 'service_role')` évalué aussi pour authenticated :
-- doublon permissive sur chaque action + réévaluation par ligne. Recréées
-- TO service_role, comme sur les autres tables.

DROP POLICY IF EXISTS service_role_full ON public.portal_form_submissions;
CREATE POLICY service_role_full ON public.portal_form_submissions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.portal_forms;
CREATE POLICY service_role_full ON public.portal_forms FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_categories;
CREATE POLICY service_role_full ON public.socle_categories FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_document_types;
CREATE POLICY service_role_full ON public.socle_document_types FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_organization_members;
CREATE POLICY service_role_full ON public.socle_organization_members FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_organization_signatories;
CREATE POLICY service_role_full ON public.socle_organization_signatories FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_organizations;
CREATE POLICY service_role_full ON public.socle_organizations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_full ON public.socle_sync_runs;
CREATE POLICY service_role_full ON public.socle_sync_runs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ─── 2. notifications : wrap initplan ───────────────────────────────────────

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT
  TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE
  TO authenticated USING (user_id = (select auth.uid()));

-- ─── 3. courier_relations : normalisation sur is_member_of ──────────────────
-- Dernière table courrier avec EXISTS inline + scoping x-org-id dans le SELECT.
-- Alignée sur le pattern standard (le filtrage par org active reste fait par
-- les services via les ids de courriers). Pas de policy UPDATE avant → pas de
-- nouveau droit. is_member_of ajoute le superadmin, comme partout.

DROP POLICY IF EXISTS "Members can read org relations" ON public.courier_relations;
DROP POLICY IF EXISTS "Members can insert org relations" ON public.courier_relations;
DROP POLICY IF EXISTS "Members can delete org relations" ON public.courier_relations;
CREATE POLICY auth_select ON public.courier_relations FOR SELECT
  TO authenticated USING (public.is_member_of(organization_id));
CREATE POLICY auth_insert ON public.courier_relations FOR INSERT
  TO authenticated WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY auth_delete ON public.courier_relations FOR DELETE
  TO authenticated USING (public.is_member_of(organization_id));
CREATE POLICY service_role_full ON public.courier_relations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ─── 4. ai_usage_quotas : superadmin_write (ALL) → écritures seules ──────────
-- Le volet SELECT de superadmin_write doublonnait auth_select (is_member_of
-- inclut le superadmin). Les lignes globales (organization_id NULL) restent
-- lisibles/modifiables par le seul superadmin, comme avant.

DROP POLICY IF EXISTS superadmin_write ON public.ai_usage_quotas;
CREATE POLICY superadmin_insert ON public.ai_usage_quotas FOR INSERT
  TO authenticated WITH CHECK (public.is_superadmin((select auth.uid())));
CREATE POLICY superadmin_update ON public.ai_usage_quotas FOR UPDATE
  TO authenticated
  USING (public.is_superadmin((select auth.uid())))
  WITH CHECK (public.is_superadmin((select auth.uid())));
CREATE POLICY superadmin_delete ON public.ai_usage_quotas FOR DELETE
  TO authenticated USING (public.is_superadmin((select auth.uid())));

-- ─── 5. organization_users : fusion du SELECT, superadmin_all redondante ─────
-- admins_insert/update/delete (is_admin_of) couvrent déjà le superadmin.

DROP POLICY IF EXISTS superadmin_all ON public.organization_users;
DROP POLICY IF EXISTS admins_read_org_members ON public.organization_users;
DROP POLICY IF EXISTS users_read_own_memberships ON public.organization_users;
CREATE POLICY org_users_select ON public.organization_users FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()) OR public.is_admin_of(organization_id));

-- ─── 6. organizations : helpers à la place des EXISTS inline ─────────────────
-- is_member_of / is_admin_of exigent is_active : un membre désactivé perd la
-- visibilité de son org (durcissement voulu).

DROP POLICY IF EXISTS users_read_own_org ON public.organizations;
DROP POLICY IF EXISTS superadmin_select_orgs ON public.organizations;
DROP POLICY IF EXISTS org_admin_update_own_org ON public.organizations;
DROP POLICY IF EXISTS superadmin_update_orgs ON public.organizations;
DROP POLICY IF EXISTS superadmin_insert_orgs ON public.organizations;
DROP POLICY IF EXISTS superadmin_delete_orgs ON public.organizations;
CREATE POLICY org_select ON public.organizations FOR SELECT
  TO authenticated USING (public.is_member_of(id));
CREATE POLICY org_admin_update ON public.organizations FOR UPDATE
  TO authenticated
  USING (public.is_admin_of(id))
  WITH CHECK (public.is_admin_of(id));
CREATE POLICY superadmin_insert_orgs ON public.organizations FOR INSERT
  TO authenticated WITH CHECK (public.is_superadmin((select auth.uid())));
CREATE POLICY superadmin_delete_orgs ON public.organizations FOR DELETE
  TO authenticated USING (public.is_superadmin((select auth.uid())));

-- ─── 7. smtp_settings : miroir du pattern imap_settings ─────────────────────
-- org_admin_read_smtp (role = 'admin' seul, sans is_active) était un
-- sous-ensemble de org_admin_write_smtp ; superadmin_all_smtp doublonnait
-- is_admin_of. Une seule policy admin + service_role explicite.

DROP POLICY IF EXISTS org_admin_read_smtp ON public.smtp_settings;
DROP POLICY IF EXISTS superadmin_all_smtp ON public.smtp_settings;
DROP POLICY IF EXISTS org_admin_write_smtp ON public.smtp_settings;
CREATE POLICY smtp_admin ON public.smtp_settings FOR ALL
  TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY service_role_full_smtp ON public.smtp_settings FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ─── 8. users : fusion par action + verrou is_superadmin ────────────────────
-- Avant : 4 policies SELECT, 3 UPDATE, 2 INSERT qui s'empilaient. Les branches
-- x-org-id (org_members_select / org_members_update) ne vérifiaient PAS que le
-- demandeur appartient à l'org du header ; remplacées par « admin d'une org du
-- user cible ». Le WITH CHECK re-verrouille is_superadmin au niveau policy
-- (défense en profondeur, en plus du trigger users_prevent_superadmin_escalation).

DROP POLICY IF EXISTS users_read_own ON public.users;
DROP POLICY IF EXISTS org_members_read_basic ON public.users;
DROP POLICY IF EXISTS org_members_select ON public.users;
DROP POLICY IF EXISTS superadmin_all_users ON public.users;
DROP POLICY IF EXISTS org_members_insert ON public.users;
DROP POLICY IF EXISTS org_members_update ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;

-- SELECT : soi-même, superadmin, ou membre d'une org partagée. Le sous-select
-- sur organization_users reste soumis à sa RLS : un membre voit ses propres
-- memberships, un admin ceux de son org (comportement inchangé).
CREATE POLICY users_select ON public.users FOR SELECT
  TO authenticated
  USING (
    id = (select auth.uid())
    OR public.is_superadmin((select auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.organization_users ou_self
      JOIN public.organization_users ou_target
        ON ou_target.organization_id = ou_self.organization_id
      WHERE ou_self.user_id = (select auth.uid())
        AND ou_target.user_id = users.id
    )
  );

-- INSERT : superadmin, ou contexte org (header présent) mais jamais avec
-- is_superadmin = true (l'ancienne policy laissait passer le flag).
CREATE POLICY users_insert ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_superadmin((select auth.uid()))
    OR (
      (((select current_setting('request.headers'::text, true))::json ->> 'x-org-id') IS NOT NULL)
      AND is_superadmin = false
    )
  );

-- UPDATE : soi-même, superadmin, ou admin d'une org du user cible
-- (couvre la désactivation/réactivation d'un membre par un admin, userService).
CREATE POLICY users_update ON public.users FOR UPDATE
  TO authenticated
  USING (
    id = (select auth.uid())
    OR public.is_superadmin((select auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND public.is_admin_of(ou.organization_id)
    )
  )
  WITH CHECK (
    (public.is_superadmin((select auth.uid())) OR is_superadmin = false)
    AND (
      id = (select auth.uid())
      OR public.is_superadmin((select auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.organization_users ou
        WHERE ou.user_id = users.id
          AND public.is_admin_of(ou.organization_id)
      )
    )
  );
