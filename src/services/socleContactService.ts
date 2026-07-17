import { supabase } from "@/integrations/supabase/client";
import {
  duplicateSearchFragments,
  hasDuplicateSignal,
  matchContact,
  normalizeEmail,
  type ContactDraft,
  type DuplicateReason,
} from "@/lib/contact-duplicates";

/**
 * Contacts du référentiel Socle — point d'appel UNIQUE côté client.
 *
 * Le Socle est la source de vérité des contacts : Clara ne stocke aucune
 * identité localement, seulement des références (`courier_participants.socle_contact_id`).
 * Tous les appels passent par l'edge function `socle-contacts` (proxy
 * authentifié qui porte la clé API Socle, scope `contacts`). Aucun composant
 * ne doit appeler le Socle autrement que par ce service.
 */

export type SocleContactType = "personne" | "entreprise" | "association" | "administration";
export type SocleContactStatus = "active" | "archived";
export type SocleContactCivility = "madame" | "monsieur";

export const SOCLE_CONTACT_TYPE_LABELS: Record<SocleContactType, string> = {
  personne: "Personne",
  entreprise: "Entreprise",
  association: "Association",
  administration: "Administration",
};

export interface SocleContactRole {
  id: string;
  name: string;
}

export interface SocleContactRoleCatalogEntry {
  id: string;
  organization_id: string;
  name: string;
  created_at: string | null;
}

export interface SocleContactExternalReference {
  id: string;
  source: string;
  external_id: string;
  created_at: string | null;
  updated_at: string | null;
}

/** L'autre bout d'une relation entre contacts (référence courte). */
export interface SocleContactRelationPeer {
  id: string;
  display_name: string | null;
  contact_type: SocleContactType;
}

/**
 * Relation dirigée entre deux contacts : dans `relations`, le contact porteur
 * est <rôle> de `contact` (ex. Gérant de la Boulangerie) ; dans
 * `reverse_relations`, `contact` est <rôle> du contact porteur.
 */
export interface SocleContactRelation {
  id: string;
  role: SocleContactRole;
  contact: SocleContactRelationPeer;
}

/** Relation sortante à écrire (remplace l'ensemble si fourni). */
export interface SocleContactRelationInput {
  related_contact_id: string;
  role_id: string;
}

/** Fiche contact telle que sérialisée par l'API contacts du Socle. */
export interface SocleContact {
  id: string;
  organization_id: string;
  contact_type: SocleContactType;
  civility: SocleContactCivility | null;
  first_name: string | null;
  last_name: string | null;
  usage_name: string | null;
  birth_date: string | null;
  legal_name: string | null;
  siret: string | null;
  display_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  preferred_channel: "email" | "telephone" | "courrier" | null;
  consent_email: boolean;
  consent_sms: boolean;
  /** Notes internes agents — ne JAMAIS retransmettre à un usager final. */
  internal_notes: string | null;
  status: SocleContactStatus;
  roles: SocleContactRole[];
  external_references: SocleContactExternalReference[];
  /** Ce contact est <rôle> de… (relations sortantes). */
  relations: SocleContactRelation[];
  /** … est <rôle> de ce contact (relations entrantes, lecture seule). */
  reverse_relations: SocleContactRelation[];
  created_at: string | null;
  updated_at: string | null;
}

/** Payload de création (POST /v1/contacts). Le Socle valide les invariants par type. */
export interface SocleContactInput {
  contact_type: SocleContactType;
  civility?: SocleContactCivility | null;
  first_name?: string | null;
  last_name?: string | null;
  usage_name?: string | null;
  birth_date?: string | null;
  legal_name?: string | null;
  siret?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  landline_phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  preferred_channel?: "email" | "telephone" | "courrier" | null;
  consent_email?: boolean;
  consent_sms?: boolean;
  internal_notes?: string | null;
  /** Remplace l'ensemble des rôles si fourni ([] = tout retirer). */
  role_ids?: string[];
  external_references?: { source: string; external_id: string }[];
  /** Remplace l'ensemble des relations sortantes si fourni ([] = tout retirer). */
  relations?: SocleContactRelationInput[];
}

/** Payload de modification (PATCH) — `contact_type` est immuable côté Socle. */
export type SocleContactUpdate = Omit<Partial<SocleContactInput>, "contact_type">;

export interface SocleContactListFilters {
  /** Recherche insensible à la casse dans le nom d'affichage. */
  search?: string;
  /** Email exact (insensible à la casse) — rapprochement fiable. */
  email?: string;
  type?: SocleContactType;
  status?: SocleContactStatus;
  /** 1..500, défaut 100 côté Socle. */
  limit?: number;
  offset?: number;
}

/** Erreur applicative renvoyée par le Socle ou le proxy (enveloppe { error: { code, message } }). */
export class SocleContactApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "SocleContactApiError";
  }
}

export function isContactNotFound(e: unknown): boolean {
  return e instanceof SocleContactApiError && e.status === 404;
}

/** Types proposables comme cible d'une relation — jamais « personne ». */
export const RELATION_STRUCTURE_TYPES: SocleContactType[] = [
  "entreprise",
  "association",
  "administration",
];

/**
 * Types de contact proposables comme cible d'une relation, selon le rôle :
 * Gérant / Représentant / Propriétaire → entreprise ; Président → entreprise ou
 * association ; Agent → administration ; sinon toute structure. Une relation ne
 * cible JAMAIS une personne physique (pas de lien entre deux personnes — règle
 * aussi imposée par le référentiel).
 */
export function relationTargetTypes(roleName: string): SocleContactType[] {
  const n = roleName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (n.includes("gerant") || n.includes("representant") || n.includes("proprietaire")) {
    return ["entreprise"];
  }
  if (n.includes("president")) return ["entreprise", "association"];
  if (n.includes("agent")) return ["administration"];
  return RELATION_STRUCTURE_TYPES;
}

/**
 * Lignes compactes résumant les relations d'un contact, deux sens confondus :
 * « Gérant — Boulangerie du Forum SARL » (il est gérant de…) puis
 * « Benali Karim (Gérant) » (untel est gérant de ce contact).
 */
export function contactRelationLines(
  c: Pick<SocleContact, "relations" | "reverse_relations">,
): { key: string; contactId: string; text: string }[] {
  const out = (c.relations ?? []).map((r) => ({
    key: r.id,
    contactId: r.contact.id,
    text: `${r.role.name} — ${r.contact.display_name ?? "?"}`,
  }));
  const rev = (c.reverse_relations ?? []).map((r) => ({
    key: `rev-${r.id}`,
    contactId: r.contact.id,
    text: `${r.contact.display_name ?? "?"} (${r.role.name})`,
  }));
  return [...out, ...rev];
}

interface InvokeBody {
  action: "list" | "get" | "create" | "update" | "archive" | "restore" | "roles";
  organization_id: string;
  id?: string;
  payload?: Record<string, unknown>;
  filters?: SocleContactListFilters;
}

async function invokeSocleContacts<T>(body: InvokeBody): Promise<T> {
  const { data, error } = await supabase.functions.invoke("socle-contacts", { body });
  if (error) {
    // Non-2xx : l'enveloppe { error: { code, message } } est dans error.context (Response).
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      let payload: { error?: { code?: string; message?: string } } | null = null;
      try {
        payload = await ctx.json();
      } catch {
        /* corps non JSON */
      }
      if (payload?.error?.message) {
        throw new SocleContactApiError(
          payload.error.message,
          payload.error.code ?? "unknown",
          ctx.status ?? 0,
        );
      }
    }
    throw new SocleContactApiError(
      error.message || "Référentiel de contacts injoignable.",
      "unknown",
      0,
    );
  }
  return data as T;
}

export async function listContacts(
  organizationId: string,
  filters: SocleContactListFilters = {},
): Promise<SocleContact[]> {
  return invokeSocleContacts<SocleContact[]>({
    action: "list",
    organization_id: organizationId,
    filters,
  });
}

export async function getContact(organizationId: string, id: string): Promise<SocleContact> {
  return invokeSocleContacts<SocleContact>({ action: "get", organization_id: organizationId, id });
}

export async function createContact(
  organizationId: string,
  input: SocleContactInput,
): Promise<SocleContact> {
  return invokeSocleContacts<SocleContact>({
    action: "create",
    organization_id: organizationId,
    payload: input as unknown as Record<string, unknown>,
  });
}

export async function updateContact(
  organizationId: string,
  id: string,
  patch: SocleContactUpdate,
): Promise<SocleContact> {
  return invokeSocleContacts<SocleContact>({
    action: "update",
    organization_id: organizationId,
    id,
    payload: patch as unknown as Record<string, unknown>,
  });
}

export async function archiveContact(organizationId: string, id: string): Promise<SocleContact> {
  return invokeSocleContacts<SocleContact>({ action: "archive", organization_id: organizationId, id });
}

export async function restoreContact(organizationId: string, id: string): Promise<SocleContact> {
  return invokeSocleContacts<SocleContact>({ action: "restore", organization_id: organizationId, id });
}

export async function listContactRoles(
  organizationId: string,
): Promise<SocleContactRoleCatalogEntry[]> {
  return invokeSocleContacts<SocleContactRoleCatalogEntry[]>({
    action: "roles",
    organization_id: organizationId,
  });
}

/** Rapprochement par email exact (auto-match de l'expéditeur). Null si aucun contact. */
export async function findContactByEmail(
  organizationId: string,
  email: string,
): Promise<SocleContact | null> {
  const cleaned = email.trim();
  if (!cleaned) return null;
  const matches = await listContacts(organizationId, { email: cleaned, limit: 1 });
  return matches[0] ?? null;
}

/** Nombre de fiches ramenées par fragment de nom avant rapprochement local. */
const DUPLICATE_CANDIDATE_LIMIT = 25;
const DUPLICATE_RESULT_LIMIT = 5;

export interface DuplicateCandidate {
  contact: SocleContact;
  reasons: DuplicateReason[];
  score: number;
}

/**
 * Doublons potentiels d'une saisie dans le référentiel : quelques requêtes
 * bornées (email exact + fragments de nom) puis rapprochement local (cf.
 * `lib/contact-duplicates.ts` — le Socle n'offre ni filtre téléphone ni
 * recherche floue).
 *
 * Best-effort : un référentiel injoignable ne remonte aucun doublon plutôt que
 * de faire échouer la saisie — la détection assiste, elle ne bloque jamais.
 */
export async function findPotentialDuplicates(
  organizationId: string,
  draft: ContactDraft,
  opts: { excludeIds?: string[]; limit?: number } = {},
): Promise<DuplicateCandidate[]> {
  if (!organizationId || !hasDuplicateSignal(draft)) return [];

  const base: SocleContactListFilters = {
    status: "active",
    ...(draft.contact_type ? { type: draft.contact_type } : {}),
  };
  const queries: Promise<SocleContact[]>[] = [];

  const email = normalizeEmail(draft.email);
  if (email.includes("@")) {
    queries.push(listContacts(organizationId, { ...base, email, limit: DUPLICATE_RESULT_LIMIT }));
  }
  for (const search of duplicateSearchFragments(draft)) {
    queries.push(listContacts(organizationId, { ...base, search, limit: DUPLICATE_CANDIDATE_LIMIT }));
  }

  const pages = await Promise.all(queries.map((q) => q.catch(() => [] as SocleContact[])));

  const excluded = new Set(opts.excludeIds ?? []);
  const byId = new Map<string, SocleContact>();
  for (const contact of pages.flat()) {
    if (!excluded.has(contact.id)) byId.set(contact.id, contact);
  }

  return [...byId.values()]
    .flatMap((contact) => {
      const match = matchContact(draft, contact);
      return match ? [{ contact, reasons: match.reasons, score: match.score }] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.contact.display_name ?? "").localeCompare(b.contact.display_name ?? "", "fr"),
    )
    .slice(0, opts.limit ?? DUPLICATE_RESULT_LIMIT);
}

const EXPORT_PAGE_SIZE = 500;

/** Charge tout le référentiel par pages de 500 (export CSV de l'annuaire). */
export async function fetchAllContactsForExport(
  organizationId: string,
  filters: Omit<SocleContactListFilters, "limit" | "offset"> = {},
): Promise<SocleContact[]> {
  const all: SocleContact[] = [];
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await listContacts(organizationId, {
      ...filters,
      limit: EXPORT_PAGE_SIZE,
      offset,
    });
    all.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  return all;
}
