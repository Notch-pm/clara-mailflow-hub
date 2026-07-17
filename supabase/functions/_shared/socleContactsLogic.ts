/**
 * Logique pure du client contacts Socle (aucun import Deno — testée par Vitest
 * dans src/test/socle/socle-contacts-logic.test.ts) : résolution de la clé API
 * par organisation racine Socle et construction des requêtes vers `contacts-api`.
 *
 * Le référentiel des contacts vit au niveau de l'organisation RACINE du Socle :
 * la clé API (scope `contacts`) est rattachée à cette racine et borne tout le
 * périmètre. Le secret SOCLE_CONTACTS_API_KEYS est un JSON
 * `{ "<socle_org_id>": "sk_live_…" }` : chaque tenant Clara (via
 * organizations.socle_org_id) pointe vers la clé de son référentiel — plusieurs
 * tenants rattachés à la même racine partagent la même clé, donc le même
 * référentiel (modèle Socle : contacts au niveau racine uniquement).
 */

export type SocleContactsAction =
  | "list"
  | "get"
  | "match"
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "roles";

export interface SocleContactsRequest {
  method: "GET" | "POST" | "PATCH";
  /** Chemin relatif à la base contacts-api, ex. `/v1/contacts?limit=20`. */
  path: string;
  body?: Record<string, unknown>;
  /**
   * Rejouable en cas d'échec réseau ou 5xx. Critère : l'absence d'effet de
   * bord, pas le verbe HTTP — `/v1/contacts/match` est un POST (l'identité
   * partielle passe mal en query string) mais ne crée ni ne modifie rien. Les
   * écritures ne sont jamais rejouées, elles, au risque du doublon.
   */
  idempotent: boolean;
}

export type BuildResult =
  | { ok: true; request: SocleContactsRequest }
  | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parse le secret SOCLE_CONTACTS_API_KEYS ; tolérant : entrée invalide → map vide. */
export function parseKeyMap(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const map: Record<string, string> = {};
  for (const [orgId, key] of Object.entries(parsed)) {
    // trim défensif : un espace collé au secret casserait le hash SHA-256 côté Socle
    if (typeof key === "string" && key.trim() !== "") map[orgId] = key.trim();
  }
  return map;
}

export function resolveApiKey(
  keyMap: Record<string, string>,
  socleOrgId: string | null | undefined,
): string | null {
  if (!socleOrgId) return null;
  return keyMap[socleOrgId] ?? null;
}

export interface SocleContactsListFilters {
  search?: string;
  email?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface BuildParams {
  id?: unknown;
  payload?: unknown;
  filters?: unknown;
}

function listQueryString(filters: SocleContactsListFilters): string {
  const qs = new URLSearchParams();
  for (const key of ["search", "email", "type", "status"] as const) {
    const value = filters[key];
    if (typeof value === "string" && value.trim() !== "") qs.set(key, value.trim());
  }
  for (const key of ["limit", "offset"] as const) {
    const value = filters[key];
    if (typeof value === "number" && Number.isFinite(value)) qs.set(key, String(value));
  }
  const s = qs.toString();
  return s === "" ? "" : `?${s}`;
}

function requireContactId(id: unknown): string | null {
  return isUuid(id) ? id : null;
}

function requirePayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

/** Traduit `{ action, id?, payload?, filters? }` en requête HTTP vers contacts-api. */
export function buildSocleRequest(action: unknown, params: BuildParams = {}): BuildResult {
  switch (action) {
    case "list": {
      const filters = (params.filters ?? {}) as SocleContactsListFilters;
      return {
        ok: true,
        request: { method: "GET", path: `/v1/contacts${listQueryString(filters)}`, idempotent: true },
      };
    }
    case "roles":
      return { ok: true, request: { method: "GET", path: "/v1/contact-roles", idempotent: true } };
    case "get": {
      const id = requireContactId(params.id);
      if (!id) return { ok: false, message: "id de contact invalide (uuid attendu)." };
      return { ok: true, request: { method: "GET", path: `/v1/contacts/${id}`, idempotent: true } };
    }
    case "match": {
      const payload = requirePayload(params.payload);
      if (!payload) return { ok: false, message: "payload de rapprochement manquant ou invalide." };
      return {
        // Lecture seule malgré le POST : rejouable sans risque.
        ok: true,
        request: { method: "POST", path: "/v1/contacts/match", body: payload, idempotent: true },
      };
    }
    case "create": {
      const payload = requirePayload(params.payload);
      if (!payload) return { ok: false, message: "payload de création manquant ou invalide." };
      return {
        ok: true,
        request: { method: "POST", path: "/v1/contacts", body: payload, idempotent: false },
      };
    }
    case "update": {
      const id = requireContactId(params.id);
      if (!id) return { ok: false, message: "id de contact invalide (uuid attendu)." };
      const payload = requirePayload(params.payload);
      if (!payload) return { ok: false, message: "payload de modification manquant ou invalide." };
      return {
        ok: true,
        request: { method: "PATCH", path: `/v1/contacts/${id}`, body: payload, idempotent: false },
      };
    }
    case "archive":
    case "restore": {
      const id = requireContactId(params.id);
      if (!id) return { ok: false, message: "id de contact invalide (uuid attendu)." };
      return {
        ok: true,
        // Idempotent côté Socle, mais on ne rejoue pas les écritures par prudence.
        request: { method: "POST", path: `/v1/contacts/${id}/${action}`, idempotent: false },
      };
    }
    default:
      return {
        ok: false,
        message:
          "action inconnue (attendu : list, get, match, create, update, archive, restore, roles).",
      };
  }
}
