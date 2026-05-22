-- Nettoyage des anomalies RLS identifiées le 2026-05-22.
-- Objectif : toutes les policies utilisent is_member_of / is_admin_of / is_superadmin
-- sans aucun EXISTS inline ni dépendance au header x-org-id.

-- ─── 1. organization_users : suppression des 4 policies legacy x-org-id ────
-- Redondantes avec admins_*, superadmin_all et users_read_own_memberships.
DROP POLICY IF EXISTS auth_select ON public.organization_users;
DROP POLICY IF EXISTS auth_insert ON public.organization_users;
DROP POLICY IF EXISTS auth_update ON public.organization_users;
DROP POLICY IF EXISTS auth_delete ON public.organization_users;

-- ─── 2. service_members : remplace x-org-id par is_admin_of ─────────────────
DROP POLICY IF EXISTS service_members_select ON public.service_members;
DROP POLICY IF EXISTS service_members_insert ON public.service_members;
DROP POLICY IF EXISTS service_members_delete ON public.service_members;
CREATE POLICY service_members_select ON public.service_members FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY service_members_insert ON public.service_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY service_members_delete ON public.service_members FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- ─── 3. imap_settings : remplace EXISTS inline par is_admin_of ──────────────
DROP POLICY IF EXISTS org_admin_write_imap ON public.imap_settings;
DROP POLICY IF EXISTS org_admin_read_imap  ON public.imap_settings;
DROP POLICY IF EXISTS superadmin_all_imap  ON public.imap_settings;
CREATE POLICY imap_admin ON public.imap_settings FOR ALL TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ─── 4. organization_integrations : supprime la policy superadmin redondante ─
-- org_admin_manage_integrations utilise déjà is_admin_of (qui inclut superadmin).
DROP POLICY IF EXISTS superadmin_all_integrations ON public.organization_integrations;

-- ─── 5. organizations : remplace EXISTS inline par is_superadmin() ───────────
DROP POLICY IF EXISTS superadmin_select_orgs ON public.organizations;
DROP POLICY IF EXISTS superadmin_insert_orgs ON public.organizations;
DROP POLICY IF EXISTS superadmin_update_orgs ON public.organizations;
DROP POLICY IF EXISTS superadmin_delete_orgs ON public.organizations;
CREATE POLICY superadmin_select_orgs ON public.organizations FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));
CREATE POLICY superadmin_insert_orgs ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY superadmin_update_orgs ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY superadmin_delete_orgs ON public.organizations FOR DELETE TO authenticated
  USING (public.is_superadmin(auth.uid()));
