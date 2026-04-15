
-- organization_users: direct org isolation
CREATE POLICY "org_isolation" ON public.organization_users
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- roles: direct org isolation
CREATE POLICY "org_isolation" ON public.roles
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- users: visible only if member of current org (via organization_users)
CREATE POLICY "org_isolation" ON public.users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id = (current_setting('request.header.x-org-id', true))::uuid
    )
  );

-- users: allow insert (creating new users)
CREATE POLICY "allow_insert" ON public.users
  FOR INSERT
  WITH CHECK (true);

-- users: allow update only for users in current org
CREATE POLICY "org_update" ON public.users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_users ou
      WHERE ou.user_id = users.id
        AND ou.organization_id = (current_setting('request.header.x-org-id', true))::uuid
    )
  );
