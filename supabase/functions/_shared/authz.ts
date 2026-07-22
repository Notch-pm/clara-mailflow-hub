// Garde d'autorisation partagée : « éditeur » = membre actif d'une organisation
// dont le rôle n'est PAS `consultant` (rôle en lecture seule). Le superadmin
// (`users.is_superadmin`) est toujours éditeur, quelle que soit son
// appartenance à l'organisation.
//
// Les edge functions tournent en service_role et BYPASSENT la RLS : la RLS ne
// protège donc PAS ces handlers contre un appelant `consultant`. Chaque
// fonction qui produit un effet de bord (écriture DB, envoi d'email, appel
// d'API externe, génération IA...) doit appeler `assertEditor` juste après
// avoir résolu l'utilisateur et l'organisation, AVANT tout effet de bord.

/** Ligne combinée des deux requêtes de ce module (colonnes jamais toutes
 *  sélectionnées ensemble ; l'union reste sûre pour un type interne). */
interface AuthzRow {
  is_superadmin?: boolean | null;
  role?: string | null;
}

interface AuthzSingleResult {
  single: () => Promise<{ data: AuthzRow | null; error: unknown }>;
}

interface AuthzEqChain extends AuthzSingleResult {
  eq: (column: string, value: string | boolean) => AuthzEqChain;
  limit: (count: number) => AuthzSingleResult;
}

/**
 * Client Supabase minimal requis par ce module : uniquement le sous-ensemble
 * du query builder Postgrest utilisé ci-dessous. Volontairement structurel
 * plutôt que figé sur une version précise de `@supabase/supabase-js` : les
 * fonctions appelantes importent `createClient` depuis des specifiers esm.sh
 * différents (`@2`, `@2.49.4`...) — un type nominal (classe) nous forcerait à
 * en choisir un et casserait l'assignabilité pour les autres appelants.
 */
interface AdminClientLike {
  from: (table: string) => { select: (columns: string) => AuthzEqChain };
}

/**
 * Renvoie `true` si `userId` peut écrire dans `orgId` (superadmin, ou membre
 * actif avec un rôle différent de `consultant`), `false` sinon.
 *
 * Utilise le client service-role (bypass RLS sur `organization_users`), comme
 * `verifyOrgMembership` dans `storage-documents/index.ts`.
 */
export async function assertEditor(
  admin: AdminClientLike,
  userId: string,
  orgId: string,
): Promise<boolean> {
  // Superadmins sont toujours éditeurs
  const { data: userRow } = await admin
    .from("users")
    .select("is_superadmin")
    .eq("id", userId)
    .single();

  if (userRow?.is_superadmin) return true;

  const { data, error } = await admin
    .from("organization_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error || !data) return false;

  return data.role !== "consultant";
}
