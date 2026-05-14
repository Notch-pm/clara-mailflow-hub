-- 1) Prevent self-escalation to superadmin
DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND is_superadmin = false);

-- Trigger guard (function already exists)
DROP TRIGGER IF EXISTS users_prevent_superadmin_escalation ON public.users;
CREATE TRIGGER users_prevent_superadmin_escalation
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_superadmin_escalation();

-- 2) Scope notifications policies to authenticated role
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());