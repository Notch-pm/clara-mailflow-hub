
-- 1. Skip notifying the user who created the courier
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
      AND ou.is_active = true
      AND (NEW.created_by IS NULL OR ou.user_id <> NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_create_courier_notifications() FROM PUBLIC, anon, authenticated;

-- 2. When a courier leaves the "pending" category, mark related notifications as read
CREATE OR REPLACE FUNCTION public.fn_mark_courier_notifications_read()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_cat text;
  old_cat text;
BEGIN
  IF NEW.workflow_state_id IS DISTINCT FROM OLD.workflow_state_id THEN
    SELECT category::text INTO new_cat FROM public.workflow_states WHERE id = NEW.workflow_state_id;
    SELECT category::text INTO old_cat FROM public.workflow_states WHERE id = OLD.workflow_state_id;
    IF (old_cat = 'pending' OR old_cat IS NULL) AND new_cat IS DISTINCT FROM 'pending' THEN
      UPDATE public.notifications
         SET read = true
       WHERE resource_id = NEW.id
         AND type = 'new_courier'
         AND read = false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_mark_courier_notifications_read() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mark_courier_notifications_read ON public.couriers;
CREATE TRIGGER trg_mark_courier_notifications_read
  AFTER UPDATE OF workflow_state_id ON public.couriers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_mark_courier_notifications_read();

-- 3. Realtime UPDATE events on notifications (publication already has the table; ensure REPLICA IDENTITY)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
