// Agents gérés par le Socle — logique pure de `sync-socle-users`.
//
// Le Socle décide QUI accède à Clara, sur QUEL organisme, avec QUEL rôle de
// base (`GET /v1/users`, contrat public-api 1.43.0). Clara en tire, pour un
// tenant rattaché au Socle :
//   - l'appartenance (`organization_users`) : rôle = le PLUS ÉLEVÉ des rôles
//     actifs de l'agent, actif s'il reste au moins un accès actif ;
//   - les affectations (`socle_organization_members`) : exactement les
//     organismes de ses accès actifs, quand Clara en a le miroir ;
//   - le compte : créé à la première ouverture, banni quand l'agent n'a plus
//     aucune appartenance active (jamais supprimé : l'historique reste).
//
// ⚠️ Les droits fins (signataire, viseur, service courrier, confidentiel) ne
// viennent PAS du Socle : la synchronisation n'y touche jamais.
//
// Pur, sans Deno : testé par vitest (src/test/socle/agents-sync.test.ts).

/** Rôles de Clara, du plus élevé au plus faible (docs/permissions.md). */
export const CLARA_ROLE_RANK = ["administrateur", "superviseur", "gestionnaire", "elu", "consultant"] as const;
export type ClaraRole = (typeof CLARA_ROLE_RANK)[number];

/** Rôle le moins privilégié : celui d'un code que Clara ne connaît pas. */
const FALLBACK_ROLE: ClaraRole = "consultant";

export interface SocleAgentAccess {
  organization_id: string;
  role: string;
  is_active: boolean;
}

export interface SocleAgent {
  socle_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: "active" | "suspended";
  is_active: boolean;
  accesses: SocleAgentAccess[];
}

/** Lecture tolérante d'une réponse `GET /v1/users` : un agent mal formé est écarté. */
export function readSocleAgents(body: unknown): { agents: SocleAgent[]; asOf: string | null } {
  const raw = body as { agents?: unknown; as_of?: unknown } | null;
  const asOf = typeof raw?.as_of === "string" ? raw.as_of : null;
  if (!Array.isArray(raw?.agents)) return { agents: [], asOf };
  const agents: SocleAgent[] = [];
  for (const item of raw.agents as Array<Record<string, unknown>>) {
    if (typeof item?.socle_user_id !== "string" || typeof item.email !== "string" || item.email === "") continue;
    const accesses = Array.isArray(item.accesses)
      ? (item.accesses as Array<Record<string, unknown>>)
        .filter((a) => typeof a?.organization_id === "string" && typeof a.role === "string")
        .map((a) => ({
          organization_id: a.organization_id as string,
          role: a.role as string,
          is_active: a.is_active === true,
        }))
      : [];
    agents.push({
      socle_user_id: item.socle_user_id,
      email: item.email.toLowerCase(),
      first_name: typeof item.first_name === "string" ? item.first_name : null,
      last_name: typeof item.last_name === "string" ? item.last_name : null,
      status: item.status === "suspended" ? "suspended" : "active",
      is_active: item.is_active === true,
      accesses,
    });
  }
  return { agents, asOf };
}

/** Le plus élevé des rôles donnés ; un code inconnu compte comme le plus faible. */
export function highestRole(roles: string[]): ClaraRole {
  let best = CLARA_ROLE_RANK.length - 1;
  for (const role of roles) {
    const rank = (CLARA_ROLE_RANK as readonly string[]).indexOf(role);
    if (rank !== -1 && rank < best) best = rank;
  }
  return roles.length === 0 ? FALLBACK_ROLE : CLARA_ROLE_RANK[best];
}

export interface CurrentMembership {
  id: string;
  role: string;
  is_active: boolean;
}

export interface AgentPlan {
  /** Accès en vigueur : agent actif ET accès actif. */
  active: boolean;
  /** Appartenance à écrire, ou `null` si rien ne doit changer. */
  membership: { role: string; is_active: boolean } | null;
  /** Affectations (ids `socle_organizations` de Clara) à ajouter et à retirer. */
  addAffectations: string[];
  removeAffectations: string[];
}

/**
 * Ce qu'il faut écrire pour un agent dans UN tenant.
 * `mirror` : id Socle d'organisme → id `socle_organizations` du tenant.
 * Un agent inactif garde son RÔLE (il revient à la réactivation) et perd ses
 * affectations : elles se recalculent depuis le Socle au retour.
 */
export function planAgent(
  agent: SocleAgent,
  current: CurrentMembership | null,
  currentAffectations: string[],
  mirror: Map<string, string>,
): AgentPlan {
  const activeAccesses = agent.is_active ? agent.accesses.filter((a) => a.is_active) : [];
  const active = activeAccesses.length > 0;

  const role = active ? highestRole(activeAccesses.map((a) => a.role)) : (current?.role ?? FALLBACK_ROLE);
  const membership =
    current && current.role === role && current.is_active === active
      ? null
      : current || active
        ? { role, is_active: active }
        : null; // jamais membre, et rien d'actif : rien à créer

  const desired = new Set(
    activeAccesses.map((a) => mirror.get(a.organization_id)).filter((id): id is string => Boolean(id)),
  );
  const existing = new Set(currentAffectations);
  return {
    active,
    membership,
    addAffectations: [...desired].filter((id) => !existing.has(id)).sort(),
    removeAffectations: [...existing].filter((id) => !desired.has(id)).sort(),
  };
}

/**
 * Le compte doit-il être banni ? Seulement s'il ne lui reste AUCUNE
 * appartenance active dans Clara (un agent peut servir plusieurs tenants), et
 * jamais un superadmin de Clara (administration de la plateforme, hors Socle).
 */
export function shouldBan(activeMemberships: number, isSuperadmin: boolean): boolean {
  return !isSuperadmin && activeMemberships === 0;
}

/**
 * Réconciliation complète : les agents d'un tenant que Clara rattache au Socle
 * (`socle_user_id` posé) et que la liste complète ne contient plus n'ont plus
 * d'accès (cascade côté Socle : organisme ou compte supprimé).
 */
export function missingFromFullList(managedSocleIds: string[], agents: SocleAgent[]): string[] {
  const present = new Set(agents.map((a) => a.socle_user_id));
  return managedSocleIds.filter((id) => !present.has(id));
}
