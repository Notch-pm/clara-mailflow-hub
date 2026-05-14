
-- 1. Storage: user-avatars ownership
DROP POLICY IF EXISTS user_avatars_auth_insert ON storage.objects;
DROP POLICY IF EXISTS user_avatars_auth_update ON storage.objects;
DROP POLICY IF EXISTS user_avatars_auth_delete ON storage.objects;

CREATE POLICY user_avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY user_avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY user_avatars_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 2. Drop legacy public-role policies on workflow tables
DROP POLICY IF EXISTS org_isolation ON public.workflows;
DROP POLICY IF EXISTS org_isolation ON public.workflow_states;
DROP POLICY IF EXISTS org_isolation ON public.workflow_transitions;

-- Replace header-based authenticated policies with membership-based ones for consistency
DROP POLICY IF EXISTS auth_select ON public.workflows;
DROP POLICY IF EXISTS auth_insert ON public.workflows;
DROP POLICY IF EXISTS auth_update ON public.workflows;
DROP POLICY IF EXISTS auth_delete ON public.workflows;
CREATE POLICY auth_select ON public.workflows FOR SELECT TO authenticated USING (is_member_of(organization_id));
CREATE POLICY auth_insert ON public.workflows FOR INSERT TO authenticated WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflows FOR UPDATE TO authenticated USING (is_admin_of(organization_id)) WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflows FOR DELETE TO authenticated USING (is_admin_of(organization_id));

DROP POLICY IF EXISTS auth_select ON public.workflow_states;
DROP POLICY IF EXISTS auth_insert ON public.workflow_states;
DROP POLICY IF EXISTS auth_update ON public.workflow_states;
DROP POLICY IF EXISTS auth_delete ON public.workflow_states;
CREATE POLICY auth_select ON public.workflow_states FOR SELECT TO authenticated USING (is_member_of(organization_id));
CREATE POLICY auth_insert ON public.workflow_states FOR INSERT TO authenticated WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflow_states FOR UPDATE TO authenticated USING (is_admin_of(organization_id)) WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflow_states FOR DELETE TO authenticated USING (is_admin_of(organization_id));

DROP POLICY IF EXISTS auth_select ON public.workflow_transitions;
DROP POLICY IF EXISTS auth_insert ON public.workflow_transitions;
DROP POLICY IF EXISTS auth_update ON public.workflow_transitions;
DROP POLICY IF EXISTS auth_delete ON public.workflow_transitions;
CREATE POLICY auth_select ON public.workflow_transitions FOR SELECT TO authenticated USING (is_member_of(organization_id));
CREATE POLICY auth_insert ON public.workflow_transitions FOR INSERT TO authenticated WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflow_transitions FOR UPDATE TO authenticated USING (is_admin_of(organization_id)) WITH CHECK (is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflow_transitions FOR DELETE TO authenticated USING (is_admin_of(organization_id));
