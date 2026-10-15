// Connexion Iris d'un tenant : déduite des abonnements du Socle, plus aucune
// configuration dans Clara (2026-10-15). Logique pure, testée par Vitest
// (src/test/socle/socle-iris-mirror.test.ts) — aucune dépendance Deno.
//
// Le Socle dit, pour chaque organisation, les applications souscrites par sa
// collectivité (`applications`, public-api 1.42.0). Abonnée à Iris (Clara
// l'est forcément : la clé de Clara ne voit que ses clients), la collectivité
// dépose ses demandes dans Iris avec la clé PLATEFORME de Clara
// (secret IRIS_PLATFORM_API_KEY) et l'en-tête X-Socle-Root-Organization-Id :
// aucune clé par collectivité, aucune saisie. Côté Iris, la source `clara` du
// tenant est ouverte par SA synchronisation, d'après le même champ.
//
// La ligne `organization_integrations` (provider `iris`) reste : c'est un
// MIROIR écrit par la synchronisation (racine, interrupteur, curseur de suivi
// `last_sync_at`), sans clé (`api_key` NULL ⇒ clé plateforme).
//
// Prudence, dans cet ordre :
//   - Socle antérieur à 1.42.0 (champ absent) : on ne touche à RIEN ;
//   - abonnée mais clé plateforme ou URL absente des secrets : on ne touche à
//     rien et on le dit (basculer sans clé couperait des dépôts qui marchent) ;
//   - désabonnée : la ligne est SUSPENDUE, jamais effacée — le suivi des
//     demandes déjà déposées continue (même sémantique qu'Arpège).

export interface IrisSecrets {
  apiUrl: string | null;
  platformKeyConfigured: boolean;
}

export interface IrisMirrorRow {
  api_base_url: string;
  api_key: null;
  socle_root_org_id: string;
  is_active: true;
}

export type IrisPlan =
  | { action: "ignorer"; warning: string | null }
  | { action: "ouvrir"; row: IrisMirrorRow }
  | { action: "suspendre" };

export const IRIS_APPLICATION = "iris";

export function irisPlan(
  tenantName: string,
  rootId: string,
  rootApplications: unknown,
  secrets: IrisSecrets,
): IrisPlan {
  if (!Array.isArray(rootApplications)) return { action: "ignorer", warning: null };
  if (!rootApplications.includes(IRIS_APPLICATION)) return { action: "suspendre" };
  const url = (secrets.apiUrl ?? "").trim().replace(/\/+$/, "");
  if (!url || !secrets.platformKeyConfigured) {
    return {
      action: "ignorer",
      warning:
        `Iris (${tenantName}) : souscrit dans le Socle, mais la clé plateforme Iris n'est pas ` +
        "configurée (secrets IRIS_API_URL et IRIS_PLATFORM_API_KEY) — configuration locale inchangée.",
    };
  }
  return {
    action: "ouvrir",
    row: { api_base_url: url, api_key: null, socle_root_org_id: rootId, is_active: true },
  };
}
