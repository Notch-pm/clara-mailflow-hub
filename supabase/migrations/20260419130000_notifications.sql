-- ============================================================
-- Notifications system
-- ============================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL DEFAULT 'new_courier',
  title           TEXT,
  resource_id     UUID,
  read            BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications(user_id, read);

CREATE INDEX IF NOT EXISTS idx_notifications_organization
  ON public.notifications(organization_id);

-- 3. Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

-- Users can only update their own notifications (mark as read)
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Trigger function: fan-out notifications to all active org members on inbound courier insert
CREATE OR REPLACE FUNCTION public.fn_create_courier_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    INSERT INTO public.notifications (organization_id, user_id, type, title, resource_id)
    SELECT
      NEW.organization_id,
      ou.user_id,
      'new_courier',
      COALESCE(NEW.subject, 'Nouveau courrier'),
      NEW.id
    FROM public.organization_users ou
    WHERE ou.organization_id = NEW.organization_id
      AND ou.is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_courier_notifications ON public.couriers;

CREATE TRIGGER trg_create_courier_notifications
  AFTER INSERT ON public.couriers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_create_courier_notifications();

-- 5. Enable Supabase Realtime for live push to clients
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
