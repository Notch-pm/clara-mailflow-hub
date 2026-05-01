-- The existing org_isolation/org_insert/org_update policies on public.users use 
-- 'request.header.x-org-id' (singular, invalid setting name) which silently returns NULL,
-- so the embedded users:user_id join in PostgREST returns null for other members.
-- Replace with correct policies using 'request.headers' (the standard Supabase header setting).

DROP POLICY IF EXISTS org_isolation ON public.users;
DROP POLICY IF EXISTS org_insert ON public.users;
DROP POLICY IF EXISTS org_update ON public.users;

-- Authenticated users can see profiles of any member of their current organization
CREATE POLICY org_members_select ON public.users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid
    )
  );

-- Insert allowed when x-org-id header is present (used by invite flow)
CREATE POLICY org_members_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK ((current_setting('request.headers', true)::json ->> 'x-org-id') IS NOT NULL);

-- Update allowed when target user is a member of current org
CREATE POLICY org_members_update ON public.users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid
    )
  );
