// Logique pure de la synchronisation Socle → Clara.
// AUCUN import Deno ici : ce module est importé par index.ts (edge function)
// ET par les tests Vitest (src/test/socle/).

// ── Types API Socle (contrat OpenAPI public-api) ──

export interface SocleCategory {
  id: string;
  organization_id: string | null;
  name: string;
  icon: string | null;
  created_at?: string | null;
}

export interface SocleDocumentType {
  id: string;
  organization_id: string | null;
  name: string;
  created_at?: string | null;
}

export interface SocleProcedure {
  id: string;
  organization_id: string | null;
  category_id: string | null;
  name: string;
  type: string | null;
  keywords: string[] | null;
  short_description: string | null;
  user_description: string | null;
  agent_description: string | null;
  input_duration_minutes: number | null;
  order_index: number | null;
  // Blocs JSON possédés par le Socle — stockés TELS QUELS (UUID Socle internes).
  requester_config: unknown;
  form_schema: unknown;
  knowledge_base: unknown;
  translations: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SocleOrgApi {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  type: string | null;
  status: string; // active | obsolete
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
}

// ── Types lignes Clara (sous-ensembles utiles à la sync) ──

export interface ProcedureRow {
  id: string;
  name: string;
  description: string | null;
  socle_id: string | null;
  is_displayed: boolean;
  display_order: number;
  obsoleted_at: string | null;
  type: string | null;
  keywords: unknown;
  user_description: string | null;
  agent_description: string | null;
  input_duration_minutes: number | null;
  socle_category_id: string | null;
  requester_config: unknown;
  form_schema: unknown;
  knowledge_base: unknown;
  translations: unknown;
}

export interface MirrorRow {
  id: string;
  socle_id: string;
  name: string;
  icon?: string | null;
  obsoleted_at: string | null;
}

export interface OrgMirrorRow {
  id: string;
  socle_id: string;
  socle_parent_id: string | null;
  name: string;
  slug: string | null;
  type: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  obsoleted_at: string | null;
}

// ── Normalisation des noms (rapprochement embryons ↔ Socle) ──
// Pas d'unaccent côté DB : normalisation en TypeScript.

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les diacritiques
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── Mapping payload Socle → colonnes procedures ──
// À l'update, ne touche NI is_displayed NI external_reference_id / arpege_config_fields
// (les démarches adoptées gardent leur config Arpège pour create-arpege-demande).

export interface MappedProcedureFields {
  name: string;
  description: string | null;
  display_order: number;
  type: string | null;
  keywords: string[];
  user_description: string | null;
  agent_description: string | null;
  input_duration_minutes: number | null;
  socle_category_id: string | null;
  requester_config: unknown;
  form_schema: unknown;
  knowledge_base: unknown;
  translations: unknown;
  external_source: "socle";
  socle_id: string;
  synced_at: string;
  obsoleted_at: null;
}

export function mapSocleProcedure(proc: SocleProcedure, syncedAt: string): MappedProcedureFields {
  return {
    name: proc.name,
    description: proc.short_description ?? null,
    display_order: proc.order_index ?? 0,
    type: proc.type ?? null,
    keywords: proc.keywords ?? [],
    user_description: proc.user_description ?? null,
    agent_description: proc.agent_description ?? null,
    input_duration_minutes: proc.input_duration_minutes ?? null,
    socle_category_id: proc.category_id ?? null,
    requester_config: proc.requester_config ?? null,
    form_schema: proc.form_schema ?? null,
    knowledge_base: proc.knowledge_base ?? null,
    translations: proc.translations ?? null,
    external_source: "socle",
    socle_id: proc.id,
    synced_at: syncedAt,
    obsoleted_at: null,
  };
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Compare les champs Socle d'une ligne existante avec le mapping entrant. */
export function procedureNeedsUpdate(existing: ProcedureRow, mapped: MappedProcedureFields): boolean {
  return (
    existing.name !== mapped.name ||
    (existing.description ?? null) !== mapped.description ||
    existing.display_order !== mapped.display_order ||
    (existing.type ?? null) !== mapped.type ||
    !jsonEq(existing.keywords, mapped.keywords) ||
    (existing.user_description ?? null) !== mapped.user_description ||
    (existing.agent_description ?? null) !== mapped.agent_description ||
    (existing.input_duration_minutes ?? null) !== mapped.input_duration_minutes ||
    (existing.socle_category_id ?? null) !== mapped.socle_category_id ||
    !jsonEq(existing.requester_config, mapped.requester_config) ||
    !jsonEq(existing.form_schema, mapped.form_schema) ||
    !jsonEq(existing.knowledge_base, mapped.knowledge_base) ||
    !jsonEq(existing.translations, mapped.translations) ||
    existing.obsoleted_at !== null // réapparue après obsolescence → réactivation
  );
}

// ── Planification de la sync des procedures ──

export interface ProcedureSyncPlan {
  /** Nouvelles démarches Socle sans équivalent Clara. */
  toInsert: SocleProcedure[];
  /** Embryons Clara (sans socle_id) rapprochés par nom → adoptent le socle_id. */
  toAdopt: Array<{ existingId: string; proc: SocleProcedure; reactivate: boolean }>;
  /** Démarches Socle déjà connues dont les champs ont changé (ou réapparues). */
  toUpdate: Array<{ existingId: string; proc: SocleProcedure; reactivate: boolean }>;
  /** Lignes à marquer obsolètes (disparues du Socle ou embryons sans correspondance). */
  toObsolete: string[];
  unchanged: number;
  warnings: string[];
}

/**
 * Calcule le plan de synchronisation, idempotent :
 * - upsert par socle_id ;
 * - adoption par nom normalisé pour les embryons (lignes sans socle_id) ;
 * - obsolescence (soft-delete) des socle_id disparus ET des embryons non rapprochés ;
 * - un second run sur les mêmes données ne produit que du `unchanged`.
 */
export function planProcedureSync(
  existing: ProcedureRow[],
  socleProcs: SocleProcedure[],
  syncedAt: string,
): ProcedureSyncPlan {
  const plan: ProcedureSyncPlan = {
    toInsert: [],
    toAdopt: [],
    toUpdate: [],
    toObsolete: [],
    unchanged: 0,
    warnings: [],
  };

  const bySocleId = new Map<string, ProcedureRow>();
  const embryosByName = new Map<string, ProcedureRow[]>();
  for (const row of existing) {
    if (row.socle_id) {
      bySocleId.set(row.socle_id, row);
    } else {
      const key = normalizeName(row.name);
      const list = embryosByName.get(key) ?? [];
      list.push(row);
      embryosByName.set(key, list);
    }
  }

  const adoptedIds = new Set<string>();

  for (const proc of socleProcs) {
    const known = bySocleId.get(proc.id);
    if (known) {
      const mapped = mapSocleProcedure(proc, syncedAt);
      if (procedureNeedsUpdate(known, mapped)) {
        plan.toUpdate.push({ existingId: known.id, proc, reactivate: known.obsoleted_at !== null });
      } else {
        plan.unchanged++;
      }
      continue;
    }

    // Rapprochement par nom : un embryon (même org, sans socle_id) adopte le socle_id.
    const candidates = (embryosByName.get(normalizeName(proc.name)) ?? []).filter(
      (e) => !adoptedIds.has(e.id),
    );
    if (candidates.length > 0) {
      if (candidates.length > 1) {
        plan.warnings.push(
          `Plusieurs embryons portent le nom « ${proc.name} » — adoption du premier (${candidates[0].id}).`,
        );
      }
      adoptedIds.add(candidates[0].id);
      plan.toAdopt.push({
        existingId: candidates[0].id,
        proc,
        reactivate: candidates[0].obsoleted_at !== null,
      });
    } else {
      plan.toInsert.push(proc);
    }
  }

  // Obsolescence (seulement si pas déjà obsolète — idempotent).
  const incomingIds = new Set(socleProcs.map((p) => p.id));
  for (const row of existing) {
    if (row.obsoleted_at !== null) continue;
    if (row.socle_id) {
      if (!incomingIds.has(row.socle_id)) plan.toObsolete.push(row.id);
    } else if (!adoptedIds.has(row.id)) {
      // Embryon sans correspondance Socle → remplacé (soft-delete).
      plan.toObsolete.push(row.id);
    }
  }

  return plan;
}

// ── Planification des miroirs (catégories, types de documents) ──

export interface MirrorItem {
  id: string; // UUID Socle
  name: string;
  icon?: string | null;
}

export interface MirrorSyncPlan {
  toInsert: MirrorItem[];
  toUpdate: Array<{ existingId: string; item: MirrorItem }>;
  toObsolete: string[];
  unchanged: number;
}

export function planMirrorSync(existing: MirrorRow[], incoming: MirrorItem[]): MirrorSyncPlan {
  const plan: MirrorSyncPlan = { toInsert: [], toUpdate: [], toObsolete: [], unchanged: 0 };
  const bySocleId = new Map(existing.map((r) => [r.socle_id, r]));

  for (const item of incoming) {
    const known = bySocleId.get(item.id);
    if (!known) {
      plan.toInsert.push(item);
    } else if (
      known.name !== item.name ||
      (known.icon ?? null) !== (item.icon ?? null) ||
      known.obsoleted_at !== null
    ) {
      plan.toUpdate.push({ existingId: known.id, item });
    } else {
      plan.unchanged++;
    }
  }

  const incomingIds = new Set(incoming.map((i) => i.id));
  for (const row of existing) {
    if (row.obsoleted_at === null && !incomingIds.has(row.socle_id)) {
      plan.toObsolete.push(row.id);
    }
  }

  return plan;
}

// ── Hiérarchie d'organisations (phase 2) ──

/**
 * Depuis la liste plate du périmètre de la clé, ne garde que la racine mappée
 * (`rootSocleId`) et toute sa descendance. Protégé contre les cycles de parent_id.
 * Le parent de la racine est neutralisé à null (hors périmètre du tenant Clara).
 */
export function filterSubtree(orgs: SocleOrgApi[], rootSocleId: string): SocleOrgApi[] {
  const childrenByParent = new Map<string, SocleOrgApi[]>();
  for (const org of orgs) {
    if (!org.parent_id) continue;
    const siblings = childrenByParent.get(org.parent_id) ?? [];
    siblings.push(org);
    childrenByParent.set(org.parent_id, siblings);
  }

  const root = orgs.find((o) => o.id === rootSocleId);
  if (!root) return [];

  const result: SocleOrgApi[] = [{ ...root, parent_id: null }];
  const seen = new Set<string>([root.id]);
  const stack = [...(childrenByParent.get(root.id) ?? [])];
  while (stack.length) {
    const org = stack.pop()!;
    if (seen.has(org.id)) continue; // protection cycles
    seen.add(org.id);
    result.push(org);
    stack.push(...(childrenByParent.get(org.id) ?? []));
  }
  return result;
}

/**
 * Racine (organisation principale) d'une organisation du référentiel, par
 * remontée des parent_id. Le catalogue (catégories, types de pièces — comme
 * les contacts) vit au niveau de la racine : c'est elle qui borne le
 * référentiel d'un tenant, même mappé sur une sous-organisation. Protégé
 * contre les cycles ; null si l'organisation est absente de la liste.
 */
export function rootOrgId(orgs: SocleOrgApi[], socleOrgId: string): string | null {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  let current = byId.get(socleOrgId);
  if (!current) return null;
  const seen = new Set<string>([current.id]);
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * Restreint un catalogue (catégories, types de pièces) aux entrées de la
 * racine d'un tenant. Indispensable dès que la clé API voit plusieurs
 * organisations principales (clé plateforme) : sans ce filtre, le catalogue
 * d'une racine fuiterait dans les tenants des autres. Les entrées sans
 * organisation (catalogue global éventuel) sont conservées.
 */
export function catalogueForRoot<T extends { organization_id: string | null }>(
  items: T[],
  rootId: string | null,
): T[] {
  if (!rootId) return [];
  return items.filter((i) => i.organization_id === rootId || i.organization_id === null);
}

export interface OrgSyncPlan {
  toInsert: SocleOrgApi[];
  toUpdate: Array<{ existingId: string; org: SocleOrgApi }>;
  toObsolete: string[];
  unchanged: number;
}

function orgNeedsUpdate(existing: OrgMirrorRow, incoming: SocleOrgApi): boolean {
  return (
    existing.name !== incoming.name ||
    (existing.socle_parent_id ?? null) !== (incoming.parent_id ?? null) ||
    (existing.slug ?? null) !== (incoming.slug ?? null) ||
    (existing.type ?? null) !== (incoming.type ?? null) ||
    existing.status !== incoming.status ||
    (existing.phone ?? null) !== (incoming.phone ?? null) ||
    (existing.email ?? null) !== (incoming.email ?? null) ||
    (existing.address ?? null) !== (incoming.address ?? null) ||
    (existing.logo_url ?? null) !== (incoming.logo_url ?? null) ||
    existing.obsoleted_at !== null // réapparue → réactivation
  );
}

/** Plan idempotent du miroir d'organisations (même principe que planMirrorSync). */
export function planOrganizationSync(
  existing: OrgMirrorRow[],
  incoming: SocleOrgApi[],
): OrgSyncPlan {
  const plan: OrgSyncPlan = { toInsert: [], toUpdate: [], toObsolete: [], unchanged: 0 };
  const bySocleId = new Map(existing.map((r) => [r.socle_id, r]));

  for (const org of incoming) {
    const known = bySocleId.get(org.id);
    if (!known) {
      plan.toInsert.push(org);
    } else if (orgNeedsUpdate(known, org)) {
      plan.toUpdate.push({ existingId: known.id, org });
    } else {
      plan.unchanged++;
    }
  }

  const incomingIds = new Set(incoming.map((o) => o.id));
  for (const row of existing) {
    if (row.obsoleted_at === null && !incomingIds.has(row.socle_id)) {
      plan.toObsolete.push(row.id);
    }
  }

  return plan;
}

export function mapSocleOrganization(org: SocleOrgApi, syncedAt: string) {
  return {
    socle_id: org.id,
    socle_parent_id: org.parent_id ?? null,
    name: org.name,
    slug: org.slug ?? null,
    type: org.type ?? null,
    status: org.status,
    phone: org.phone ?? null,
    email: org.email ?? null,
    address: org.address ?? null,
    logo_url: org.logo_url ?? null,
    synced_at: syncedAt,
    obsoleted_at: null,
  };
}

// ── Identité du tenant ──
// L'organisation racine du Socle fixe le nom, le slug et le logo de
// l'organisation Clara : plus d'édition côté Clara (seules les couleurs restent).

export interface TenantIdentityFields {
  name?: string;
  slug?: string;
  logo_url?: string | null;
}

/**
 * Champs d'identité à recopier de l'org racine Socle vers `organizations`.
 * Retourne null si rien ne change. Le slug n'est écrasé que si le Socle en
 * fournit un (unicité + lowercase imposés côté Clara — normalisé ici).
 */
export function planTenantIdentityUpdate(
  current: { name: string; slug: string | null; logo_url: string | null },
  root: SocleOrgApi,
): TenantIdentityFields | null {
  const fields: TenantIdentityFields = {};
  if (current.name !== root.name) fields.name = root.name;
  const rootSlug = root.slug?.trim().toLowerCase() || null;
  if (rootSlug && (current.slug ?? null) !== rootSlug) fields.slug = rootSlug;
  if ((current.logo_url ?? null) !== (root.logo_url ?? null)) {
    fields.logo_url = root.logo_url ?? null;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

export function countersFromOrgPlan(plan: OrgSyncPlan): EntityCounters {
  return {
    created: plan.toInsert.length,
    updated: plan.toUpdate.length,
    adopted: 0,
    obsoleted: plan.toObsolete.length,
    unchanged: plan.unchanged,
  };
}

// ── Compteurs ──

export interface EntityCounters {
  created: number;
  updated: number;
  adopted: number;
  obsoleted: number;
  unchanged: number;
}

export function countersFromProcedurePlan(plan: ProcedureSyncPlan): EntityCounters {
  return {
    created: plan.toInsert.length,
    updated: plan.toUpdate.length,
    adopted: plan.toAdopt.length,
    obsoleted: plan.toObsolete.length,
    unchanged: plan.unchanged,
  };
}

export function countersFromMirrorPlan(plan: MirrorSyncPlan): EntityCounters {
  return {
    created: plan.toInsert.length,
    updated: plan.toUpdate.length,
    adopted: 0,
    obsoleted: plan.toObsolete.length,
    unchanged: plan.unchanged,
  };
}
