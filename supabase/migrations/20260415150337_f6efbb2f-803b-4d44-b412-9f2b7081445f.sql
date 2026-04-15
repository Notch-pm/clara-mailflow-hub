
-- couriers: drop existing + recreate
DROP POLICY IF EXISTS "couriers_isolation" ON public.couriers;
CREATE POLICY "org_isolation" ON public.couriers
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- organizations
DROP POLICY IF EXISTS "org_isolation" ON public.organizations;
CREATE POLICY "org_isolation" ON public.organizations
  FOR ALL
  USING (id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (id = (current_setting('request.header.x-org-id', true))::uuid);

-- courier_participants
DROP POLICY IF EXISTS "org_isolation" ON public.courier_participants;
CREATE POLICY "org_isolation" ON public.courier_participants
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- courier_documents
DROP POLICY IF EXISTS "org_isolation" ON public.courier_documents;
CREATE POLICY "org_isolation" ON public.courier_documents
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- courier_events
DROP POLICY IF EXISTS "org_isolation" ON public.courier_events;
CREATE POLICY "org_isolation" ON public.courier_events
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- courier_links
DROP POLICY IF EXISTS "org_isolation" ON public.courier_links;
CREATE POLICY "org_isolation" ON public.courier_links
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- courier_sequences
DROP POLICY IF EXISTS "org_isolation" ON public.courier_sequences;
CREATE POLICY "org_isolation" ON public.courier_sequences
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- workflows
DROP POLICY IF EXISTS "org_isolation" ON public.workflows;
CREATE POLICY "org_isolation" ON public.workflows
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- workflow_states
DROP POLICY IF EXISTS "org_isolation" ON public.workflow_states;
CREATE POLICY "org_isolation" ON public.workflow_states
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);

-- workflow_transitions
DROP POLICY IF EXISTS "org_isolation" ON public.workflow_transitions;
CREATE POLICY "org_isolation" ON public.workflow_transitions
  FOR ALL
  USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid);
