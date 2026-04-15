
-- Fix search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- organizations: users can only see their own org
CREATE POLICY "org_isolation" ON public.organizations
  FOR ALL
  USING (id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (id = (current_setting('app.org_id', true))::uuid);

-- courier_participants
CREATE POLICY "org_isolation" ON public.courier_participants
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- courier_documents
CREATE POLICY "org_isolation" ON public.courier_documents
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- courier_events
CREATE POLICY "org_isolation" ON public.courier_events
  FOR ALL
  USING (organization_id = (current_setting('app.org_id_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- courier_links
CREATE POLICY "org_isolation" ON public.courier_links
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- courier_sequences
CREATE POLICY "org_isolation" ON public.courier_sequences
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- workflows
CREATE POLICY "org_isolation" ON public.workflows
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- workflow_states
CREATE POLICY "org_isolation" ON public.workflow_states
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);

-- workflow_transitions
CREATE POLICY "org_isolation" ON public.workflow_transitions
  FOR ALL
  USING (organization_id = (current_setting('app.org_id', true))::uuid)
  WITH CHECK (organization_id = (current_setting('app.org_id', true))::uuid);
