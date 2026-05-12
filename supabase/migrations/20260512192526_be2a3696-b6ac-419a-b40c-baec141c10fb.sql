
-- ============================================================================
-- SECURITY HARDENING MIGRATION
-- ============================================================================

-- 1. Helper functions (SECURITY DEFINER to avoid RLS recursion) ---------------

CREATE OR REPLACE FUNCTION public.current_user_orgs()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_users
  WHERE user_id = auth.uid() AND COALESCE(is_active, true) = true;
$$;

CREATE OR REPLACE FUNCTION public.is_member_of(_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_users
    WHERE user_id = auth.uid() AND organization_id = _org
      AND COALESCE(is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of(_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_users
    WHERE user_id = auth.uid() AND organization_id = _org
      AND COALESCE(is_active, true) = true
      AND role IN ('admin','administrateur')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_orgs() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_member_of(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_orgs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_of(uuid) TO authenticated;

-- 2. Replace org-isolation policies on all multi-tenant tables ---------------

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'action_tickets','courier_analyses','courier_document_extracts',
    'courier_documents','courier_events','courier_links','courier_notes',
    'courier_participants','courier_sequences','courier_tags','couriers',
    'procedures','roles','service_signatories','services','signatories','usagers'
  ];
  pol record;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Drop every existing policy on the table so we start clean
    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- Default per-command policies based on membership
    EXECUTE format($f$CREATE POLICY auth_select ON public.%I FOR SELECT TO authenticated USING (public.is_member_of(organization_id))$f$, t);
    EXECUTE format($f$CREATE POLICY auth_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_member_of(organization_id))$f$, t);
    EXECUTE format($f$CREATE POLICY auth_update ON public.%I FOR UPDATE TO authenticated USING (public.is_member_of(organization_id)) WITH CHECK (public.is_member_of(organization_id))$f$, t);
    EXECUTE format($f$CREATE POLICY auth_delete ON public.%I FOR DELETE TO authenticated USING (public.is_member_of(organization_id))$f$, t);
    EXECUTE format($f$CREATE POLICY service_role_full ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)$f$, t);
  END LOOP;
END $$;

-- Tighter rules for admin-managed tables ------------------------------------
DROP POLICY IF EXISTS auth_insert ON public.services;
DROP POLICY IF EXISTS auth_update ON public.services;
DROP POLICY IF EXISTS auth_delete ON public.services;
CREATE POLICY admin_insert ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.services FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.services FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS auth_insert ON public.procedures;
DROP POLICY IF EXISTS auth_update ON public.procedures;
DROP POLICY IF EXISTS auth_delete ON public.procedures;
CREATE POLICY admin_insert ON public.procedures FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id) OR public.is_superadmin(auth.uid()));
CREATE POLICY admin_update ON public.procedures FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id) OR public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_admin_of(organization_id) OR public.is_superadmin(auth.uid()));
CREATE POLICY admin_delete ON public.procedures FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id) OR public.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS auth_insert ON public.courier_tags;
DROP POLICY IF EXISTS auth_update ON public.courier_tags;
DROP POLICY IF EXISTS auth_delete ON public.courier_tags;
CREATE POLICY admin_insert ON public.courier_tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.courier_tags FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.courier_tags FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- 3. organization_users -----------------------------------------------------
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='organization_users' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organization_users', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY users_read_own_memberships ON public.organization_users FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY admins_read_org_members ON public.organization_users FOR SELECT TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY admins_insert_members ON public.organization_users FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admins_update_members ON public.organization_users FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admins_delete_members ON public.organization_users FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
CREATE POLICY superadmin_all ON public.organization_users FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY service_role_full ON public.organization_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. organizations ----------------------------------------------------------
DROP POLICY IF EXISTS org_isolation ON public.organizations;
-- keep existing users_read_own_org / org_admin_update_own_org / superadmin_* which already use auth.uid()

-- 5. organization_integrations - admin-only, drop spoofable policy ----------
DROP POLICY IF EXISTS org_isolation ON public.organization_integrations;
CREATE POLICY org_admin_manage_integrations ON public.organization_integrations FOR ALL TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- 6. users table ------------------------------------------------------------
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;

DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='users' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY users_read_own ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY org_members_read_basic ON public.users FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_users ou_self
    JOIN public.organization_users ou_target
      ON ou_target.organization_id = ou_self.organization_id
    WHERE ou_self.user_id = auth.uid()
      AND ou_target.user_id = public.users.id
  ));
CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY superadmin_all_users ON public.users FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY service_role_full_users ON public.users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Trigger preventing non-superadmin from elevating themselves
CREATE OR REPLACE FUNCTION public.prevent_superadmin_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_superadmin IS DISTINCT FROM OLD.is_superadmin
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only superadmins can change is_superadmin';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_prevent_superadmin_escalation ON public.users;
CREATE TRIGGER users_prevent_superadmin_escalation
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_superadmin_escalation();

-- 7. smtp_settings: add admin write policy ----------------------------------
DROP POLICY IF EXISTS org_admin_write_smtp ON public.smtp_settings;
CREATE POLICY org_admin_write_smtp ON public.smtp_settings FOR ALL TO authenticated
  USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- 8. Storage: clara-documents - service role only (frontend uses edge fn) ---
DROP POLICY IF EXISTS "Authenticated users can upload to clara-documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read from clara-documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete from clara-documents" ON storage.objects;

-- 9. Storage: signatures - replace x-org-id with membership-based check -----
DROP POLICY IF EXISTS signatures_org_select ON storage.objects;
DROP POLICY IF EXISTS signatures_org_insert ON storage.objects;
DROP POLICY IF EXISTS signatures_org_update ON storage.objects;
DROP POLICY IF EXISTS signatures_org_delete ON storage.objects;
CREATE POLICY signatures_member_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'signatures' AND public.is_member_of(((storage.foldername(name))[1])::uuid));
CREATE POLICY signatures_member_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'signatures' AND public.is_member_of(((storage.foldername(name))[1])::uuid));
CREATE POLICY signatures_member_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'signatures' AND public.is_member_of(((storage.foldername(name))[1])::uuid))
  WITH CHECK (bucket_id = 'signatures' AND public.is_member_of(((storage.foldername(name))[1])::uuid));
CREATE POLICY signatures_member_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'signatures' AND public.is_member_of(((storage.foldername(name))[1])::uuid));

-- 10. Revoke EXECUTE on internal SECURITY DEFINER functions -----------------
REVOKE EXECUTE ON FUNCTION public.trigger_arpege_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_fetch_inbound_emails() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_create_courier_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated;
