-- Corrective migration: 20260512192526 was marked applied but never executed,
-- so admins_read_org_members / users_read_own_memberships / etc. were never created.
-- 20260522150000 then dropped the x-org-id auth_select policy believing those existed,
-- leaving organization_users with no SELECT policy for authenticated users.

DROP POLICY IF EXISTS users_read_own_memberships ON public.organization_users;
CREATE POLICY users_read_own_memberships ON public.organization_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS admins_read_org_members ON public.organization_users;
CREATE POLICY admins_read_org_members ON public.organization_users
  FOR SELECT TO authenticated
  USING (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS superadmin_all ON public.organization_users;
CREATE POLICY superadmin_all ON public.organization_users
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS admins_insert_members ON public.organization_users;
CREATE POLICY admins_insert_members ON public.organization_users
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS admins_update_members ON public.organization_users;
CREATE POLICY admins_update_members ON public.organization_users
  FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS admins_delete_members ON public.organization_users;
CREATE POLICY admins_delete_members ON public.organization_users
  FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS service_role_full ON public.organization_users;
CREATE POLICY service_role_full ON public.organization_users
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
