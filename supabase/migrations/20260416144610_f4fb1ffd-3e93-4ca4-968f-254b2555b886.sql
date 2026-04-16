-- Add INSERT/UPDATE/DELETE policies for authenticated users on couriers
CREATE POLICY "authenticated_org_isolation"
  ON public.couriers
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for courier_participants
CREATE POLICY "authenticated_org_isolation"
  ON public.courier_participants
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for courier_documents
CREATE POLICY "authenticated_org_isolation"
  ON public.courier_documents
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for courier_events
CREATE POLICY "authenticated_org_isolation"
  ON public.courier_events
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for courier_links
CREATE POLICY "authenticated_org_isolation"
  ON public.courier_links
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for courier_sequences
CREATE POLICY "authenticated_org_isolation"
  ON public.courier_sequences
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

-- Same for workflows and related
CREATE POLICY "authenticated_org_isolation"
  ON public.workflows
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

CREATE POLICY "authenticated_org_isolation"
  ON public.workflow_states
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

CREATE POLICY "authenticated_org_isolation"
  ON public.workflow_transitions
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);

CREATE POLICY "authenticated_org_isolation"
  ON public.roles
  FOR ALL
  TO authenticated
  USING (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid)
  WITH CHECK (organization_id = (current_setting('request.header.x-org-id'::text, true))::uuid);