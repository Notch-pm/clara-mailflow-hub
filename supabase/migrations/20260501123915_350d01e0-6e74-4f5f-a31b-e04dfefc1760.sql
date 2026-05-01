-- Fix organization_users RLS: existing org_isolation policy uses 'request.header.x-org-id' (singular, invalid)
-- which silently returns NULL, blocking updates. Add proper auth_* policies aligned with other tables.

DROP POLICY IF EXISTS org_isolation ON public.organization_users;

CREATE POLICY auth_select ON public.organization_users
  FOR SELECT TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_insert ON public.organization_users
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_update ON public.organization_users
  FOR UPDATE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid)
  WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);

CREATE POLICY auth_delete ON public.organization_users
  FOR DELETE TO authenticated
  USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id'))::uuid);
