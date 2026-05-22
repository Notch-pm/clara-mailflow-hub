-- Même logique que 20260522110000 pour is_admin_of :
-- le superadmin doit passer tous les checks is_member_of() pour pouvoir
-- lire les lignes après un INSERT/UPDATE (PostgREST fait un SELECT implicite).
CREATE OR REPLACE FUNCTION public.is_member_of(_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.organization_users
      WHERE user_id = auth.uid()
        AND organization_id = _org
        AND COALESCE(is_active, true) = true
    );
$$;
