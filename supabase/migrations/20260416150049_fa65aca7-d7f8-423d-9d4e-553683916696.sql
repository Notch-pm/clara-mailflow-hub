-- courier_participants
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.courier_participants;
CREATE POLICY "auth_select" ON public.courier_participants FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.courier_participants FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.courier_participants FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.courier_participants FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- courier_documents
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.courier_documents;
CREATE POLICY "auth_select" ON public.courier_documents FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.courier_documents FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.courier_documents FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.courier_documents FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- courier_events
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.courier_events;
CREATE POLICY "auth_select" ON public.courier_events FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.courier_events FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.courier_events FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.courier_events FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- courier_links
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.courier_links;
CREATE POLICY "auth_select" ON public.courier_links FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.courier_links FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.courier_links FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.courier_links FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- courier_sequences
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.courier_sequences;
CREATE POLICY "auth_select" ON public.courier_sequences FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.courier_sequences FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.courier_sequences FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.courier_sequences FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- workflows
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.workflows;
CREATE POLICY "auth_select" ON public.workflows FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.workflows FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.workflows FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.workflows FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- workflow_states
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.workflow_states;
CREATE POLICY "auth_select" ON public.workflow_states FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.workflow_states FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.workflow_states FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.workflow_states FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- workflow_transitions
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.workflow_transitions;
CREATE POLICY "auth_select" ON public.workflow_transitions FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.workflow_transitions FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.workflow_transitions FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.workflow_transitions FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));

-- roles
DROP POLICY IF EXISTS "authenticated_org_isolation" ON public.roles;
CREATE POLICY "auth_select" ON public.roles FOR SELECT TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_insert" ON public.roles FOR INSERT TO authenticated WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_update" ON public.roles FOR UPDATE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid)) WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));
CREATE POLICY "auth_delete" ON public.roles FOR DELETE TO authenticated USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid));