
-- 1. Create a SECURITY DEFINER function to check superadmin without triggering RLS
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = _user_id AND is_superadmin = true
  )
$$;

-- 2. Drop the recursive policies
DROP POLICY IF EXISTS "superadmin_all_users" ON public.users;
DROP POLICY IF EXISTS "superadmin_all_org_users" ON public.organization_users;

-- 3. Recreate them using the safe function
CREATE POLICY "superadmin_all_users"
ON public.users
FOR ALL
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));

CREATE POLICY "superadmin_all_org_users"
ON public.organization_users
FOR ALL
TO authenticated
USING (public.is_superadmin(auth.uid()))
WITH CHECK (public.is_superadmin(auth.uid()));
