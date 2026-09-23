-- ============================================================================
-- Noms des collègues : users_select tenait sa promesse pour les seuls admins.
--
-- `users_select` (20260712090000) autorise la lecture d'un utilisateur qui
-- partage une organisation avec l'appelant, via un EXISTS sur
-- organization_users. Mais cet EXISTS reste soumis à la RLS
-- d'organization_users (`org_users_select`) : un non-administrateur n'y voit
-- que SA ligne. La jointure ne trouvait donc jamais de collègue, et un élu, un
-- gestionnaire ou un superviseur voyait « Utilisateur inconnu » dans
-- l'historique d'un courrier et des notes sans auteur. Constaté le 2026-09-23
-- sur l'espace élu (SNA).
--
-- Correctif : le test de partage d'organisation passe par une fonction
-- SECURITY DEFINER, comme is_member_of / is_admin_of. Rien de nouveau n'est
-- ouvert — c'est ce que la politique voulait déjà permettre — et
-- organization_users reste lisible par son seul titulaire et les admins.
-- L'appelant doit être membre ACTIF (même règle qu'is_member_of) ; le collègue,
-- non : l'auteur d'une note ancienne reste nommé après son départ.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.shares_organization_with(_target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_users ou_self
    JOIN public.organization_users ou_target
      ON ou_target.organization_id = ou_self.organization_id
    WHERE ou_self.user_id = auth.uid()
      AND COALESCE(ou_self.is_active, true) = true
      AND ou_target.user_id = _target
  );
$$;

REVOKE EXECUTE ON FUNCTION public.shares_organization_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_organization_with(uuid) TO authenticated;

DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT
  TO authenticated
  USING (
    id = (select auth.uid())
    OR public.is_superadmin((select auth.uid()))
    OR public.shares_organization_with(id)
  );
