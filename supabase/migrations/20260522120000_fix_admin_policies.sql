-- Recrée toutes les policies admin en utilisant is_admin_of() qui inclut
-- désormais is_superadmin() (migration 20260522110000).
-- Nécessaire car 20260512192526 et 20260514073130 ont été marquées "applied"
-- sans avoir été réellement exécutées sur le remote.

-- services -------------------------------------------------------------------
DROP POLICY IF EXISTS auth_insert   ON public.services;
DROP POLICY IF EXISTS auth_update   ON public.services;
DROP POLICY IF EXISTS auth_delete   ON public.services;
DROP POLICY IF EXISTS admin_insert  ON public.services;
DROP POLICY IF EXISTS admin_update  ON public.services;
DROP POLICY IF EXISTS admin_delete  ON public.services;
CREATE POLICY admin_insert ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.services FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.services FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- procedures -----------------------------------------------------------------
DROP POLICY IF EXISTS auth_insert   ON public.procedures;
DROP POLICY IF EXISTS auth_update   ON public.procedures;
DROP POLICY IF EXISTS auth_delete   ON public.procedures;
DROP POLICY IF EXISTS admin_insert  ON public.procedures;
DROP POLICY IF EXISTS admin_update  ON public.procedures;
DROP POLICY IF EXISTS admin_delete  ON public.procedures;
CREATE POLICY admin_insert ON public.procedures FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.procedures FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.procedures FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- courier_tags ---------------------------------------------------------------
DROP POLICY IF EXISTS auth_insert   ON public.courier_tags;
DROP POLICY IF EXISTS auth_update   ON public.courier_tags;
DROP POLICY IF EXISTS auth_delete   ON public.courier_tags;
DROP POLICY IF EXISTS admin_insert  ON public.courier_tags;
DROP POLICY IF EXISTS admin_update  ON public.courier_tags;
DROP POLICY IF EXISTS admin_delete  ON public.courier_tags;
CREATE POLICY admin_insert ON public.courier_tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_update ON public.courier_tags FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY admin_delete ON public.courier_tags FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- organization_integrations --------------------------------------------------
DROP POLICY IF EXISTS org_isolation                ON public.organization_integrations;
DROP POLICY IF EXISTS org_admin_manage_integrations ON public.organization_integrations;
CREATE POLICY org_admin_manage_integrations ON public.organization_integrations FOR ALL TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));

-- smtp_settings --------------------------------------------------------------
DROP POLICY IF EXISTS org_admin_write_smtp ON public.smtp_settings;
CREATE POLICY org_admin_write_smtp ON public.smtp_settings FOR ALL TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));

-- workflows ------------------------------------------------------------------
DROP POLICY IF EXISTS auth_insert ON public.workflows;
DROP POLICY IF EXISTS auth_update ON public.workflows;
DROP POLICY IF EXISTS auth_delete ON public.workflows;
CREATE POLICY auth_insert ON public.workflows FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflows FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflows FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- workflow_states ------------------------------------------------------------
DROP POLICY IF EXISTS auth_insert ON public.workflow_states;
DROP POLICY IF EXISTS auth_update ON public.workflow_states;
DROP POLICY IF EXISTS auth_delete ON public.workflow_states;
CREATE POLICY auth_insert ON public.workflow_states FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflow_states FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflow_states FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));

-- workflow_transitions -------------------------------------------------------
DROP POLICY IF EXISTS auth_insert ON public.workflow_transitions;
DROP POLICY IF EXISTS auth_update ON public.workflow_transitions;
DROP POLICY IF EXISTS auth_delete ON public.workflow_transitions;
CREATE POLICY auth_insert ON public.workflow_transitions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_update ON public.workflow_transitions FOR UPDATE TO authenticated
  USING (public.is_admin_of(organization_id)) WITH CHECK (public.is_admin_of(organization_id));
CREATE POLICY auth_delete ON public.workflow_transitions FOR DELETE TO authenticated
  USING (public.is_admin_of(organization_id));
