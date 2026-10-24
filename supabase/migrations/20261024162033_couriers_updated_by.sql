-- Accès concurrents à un courrier : verrouillage optimiste.
--
-- Le client n'écrit que si `updated_at` n'a pas bougé depuis son chargement
-- (`updateCourierVersioned`). En cas de refus, il doit pouvoir dire QUI a
-- modifié le courrier entre-temps (décision PO du 2026-10-24) : d'où
-- `updated_by`, posé par trigger (jamais par le client), et la RPC
-- `courier_last_editor` qui rend le nom sans exposer la table `users`.
-- Une écriture serveur (service_role, analyse, relève) laisse `updated_by` à
-- NULL : le client la traite comme une modification « système ».

ALTER TABLE public.couriers ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.couriers_set_updated_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_couriers_set_updated_by ON public.couriers;
CREATE TRIGGER trg_couriers_set_updated_by
  BEFORE UPDATE ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION public.couriers_set_updated_by();

CREATE OR REPLACE FUNCTION public.courier_last_editor(p_courier_id uuid)
RETURNS TABLE(updated_at timestamp, updated_by uuid, editor_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.updated_at, c.updated_by,
         NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '')
  FROM public.couriers c
  LEFT JOIN public.users u ON u.id = c.updated_by
  WHERE c.id = p_courier_id AND public.can_read_courier(c.id);
$$;
REVOKE EXECUTE ON FUNCTION public.courier_last_editor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_last_editor(uuid) TO authenticated, service_role;
