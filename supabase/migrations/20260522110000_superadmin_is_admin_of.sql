-- Superadmin doit pouvoir agir comme admin sur n'importe quelle organisation.
-- En incluant is_superadmin() dans is_admin_of(), toutes les policies qui
-- utilisent cette fonction héritent automatiquement du bypass superadmin.
CREATE OR REPLACE FUNCTION public.is_admin_of(_org uuid)
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
        AND role IN ('admin', 'administrateur')
    );
$$;
