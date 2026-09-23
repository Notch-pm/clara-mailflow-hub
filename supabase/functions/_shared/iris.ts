// Client HTTP de l'API d'ingestion Iris — partagé par `push-iris-request`,
// `sync-iris-requests` et `refresh-iris-status`. La logique sans réseau vit dans
// `iris-envelope.ts`.
//
// La clé d'intégration est un SECRET SERVEUR : elle est lue dans
// `organization_integrations` (table réservée superadmin + service_role) et ne
// sort jamais d'ici — ni dans un journal, ni dans une réponse HTTP.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { IrisEnvelope, IrisRequestDto } from "./iris-envelope.ts";
import type { IrisListedRequest } from "./iris-contact-requests.ts";

/** Accusé de dépôt d'un fichier (`POST /v1/uploads`) — valable 24 h. */
export interface IrisUploadReceipt {
  upload_id?: string;
  file_name?: string;
  /** Type DÉTECTÉ par Iris (signature binaire), pas celui annoncé. */
  mime_type?: string;
  size_bytes?: number;
  checksum?: string;
  expires_at?: string;
}

export const IRIS_TIMEOUT_MS = 20_000;

export interface IrisIntegration {
  api_base_url: string;
  api_key: string;
  socle_root_org_id: string | null;
  is_active: boolean;
}

/** Réponse brute d'Iris : le statut porte autant de sens que le corps. */
export interface IrisResponse<T> {
  status: number;
  body: T | null;
}

/**
 * Pourquoi il n'y a pas d'interface exploitable — la nuance compte pour
 * l'agent : un tenant qui n'utilise pas Iris ne doit pas voir d'avertissement
 * (`absente`), alors qu'une interface suspendue ou mal configurée signale un
 * dépôt à refaire plus tard.
 */
export type IrisLookupReason = "ok" | "absente" | "suspendue" | "incomplete";

export interface IrisLookup {
  integration: IrisIntegration | null;
  reason: IrisLookupReason;
}

/**
 * Connexion Iris d'un tenant. La suspension coupe le NOUVEAU trafic sans
 * interrompre le suivi des demandes déjà déposées
 * (cf. docs/partenaires-integration.md §5).
 */
export async function resolveIrisIntegration(
  supabaseAdmin: SupabaseClient,
  organizationId: string,
): Promise<IrisLookup> {
  const { data } = await supabaseAdmin
    .from("organization_integrations")
    .select("api_base_url, api_key, socle_root_org_id, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", "iris")
    .maybeSingle();

  if (!data) return { integration: null, reason: "absente" };

  const base = (data.api_base_url ?? "").trim();
  const key = (data.api_key ?? "").trim();
  if (!base || !key) return { integration: null, reason: "incomplete" };

  // Une intégration SUSPENDUE est tout de même rendue : la suspension coupe le
  // nouveau trafic, pas le suivi des demandes déjà déposées (décision PO du
  // 2026-07-23, docs/partenaires-integration.md §5). C'est à l'appelant de
  // trancher selon ce qu'il fait — déposer ou relire.
  return {
    integration: {
      api_base_url: base.replace(/\/+$/, ""),
      api_key: key,
      socle_root_org_id: data.socle_root_org_id ?? null,
      is_active: !!data.is_active,
    },
    reason: data.is_active ? "ok" : "suspendue",
  };
}

async function callIris<T>(
  integration: IrisIntegration,
  path: string,
  init: RequestInit,
): Promise<IrisResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IRIS_TIMEOUT_MS);
  // Un corps multipart porte sa FRONTIÈRE dans le Content-Type : c'est `fetch`
  // qui l'écrit, et la poser à la main ferait lire un corps tronqué à Iris.
  const isMultipart = init.body instanceof FormData;
  try {
    const response = await fetch(`${integration.api_base_url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${integration.api_key}`,
        Accept: "application/json",
        ...(init.body && !isMultipart ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    let body: T | null = null;
    try {
      body = (await response.json()) as T;
    } catch {
      // Corps vide ou non JSON : le statut suffit à décider.
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dépose une demande. Pas de retry : l'idempotence d'Iris rend le renvoi sûr,
 * mais c'est un geste explicite (bouton « Renvoyer »), pas une boucle aveugle.
 */
export function postIrisRequest(
  integration: IrisIntegration,
  envelope: IrisEnvelope,
): Promise<IrisResponse<{ created?: boolean; request?: IrisRequestDto; error?: unknown }>> {
  return callIris(integration, "/v1/requests", {
    method: "POST",
    body: JSON.stringify(envelope),
  });
}

/**
 * Dépose UN fichier dans la zone d'attente d'Iris (24 h), qui rend un
 * `upload_id` à référencer dans l'enveloppe. Un fichier jamais référencé y est
 * purgé sans conséquence : rater le dépôt de la demande ne laisse aucune trace.
 *
 * Iris lit le CONTENU réel du fichier (signature binaire) — ce que Clara
 * annonce comme type ne l'engage pas ; c'est pour cela qu'aucun filtre de
 * format n'est appliqué ici : Iris a le dernier mot, et il le motive.
 */
export function uploadIrisFile(
  integration: IrisIntegration,
  file: { bytes: Blob | Uint8Array | ArrayBuffer; fileName: string; mimeType?: string | null },
): Promise<IrisResponse<{ upload?: IrisUploadReceipt; error?: unknown }>> {
  const blob = file.bytes instanceof Blob
    ? file.bytes
    : new Blob([file.bytes], { type: file.mimeType ?? "application/octet-stream" });
  const form = new FormData();
  // Le NOM d'origine compte : Iris vérifie que l'extension colle au contenu.
  form.append("file", blob, file.fileName);
  return callIris(integration, "/v1/uploads", { method: "POST", body: form });
}

/**
 * Liste les demandes de la source modifiées depuis une date (tri `updated_at`
 * croissant) — chemin de réconciliation prévu par le contrat.
 */
export function listIrisRequests(
  integration: IrisIntegration,
  updatedSince: string | null,
  limit = 500,
): Promise<IrisResponse<{ requests?: IrisRequestDto[]; error?: unknown }>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (updatedSince) params.set("updated_since", updatedSince);
  return callIris(integration, `/v1/requests?${params.toString()}`, { method: "GET" });
}

/**
 * Les demandes d'UN usager (`GET /v1/requests?socle_contact_id=`, contrat 2.4.0).
 * Toutes sources du tenant si la clé porte `requests:read_tenant` ; sinon Iris
 * ne rend que celles de la source `clara` — la vue est alors partielle, pas en
 * erreur.
 */
export function listIrisRequestsByContact(
  integration: IrisIntegration,
  socleContactId: string,
  limit = 500,
): Promise<IrisResponse<{ requests?: IrisListedRequest[]; error?: unknown }>> {
  const params = new URLSearchParams({ socle_contact_id: socleContactId, limit: String(limit) });
  return callIris(integration, `/v1/requests?${params.toString()}`, { method: "GET" });
}

/**
 * Relit UNE demande (`GET /v1/requests/{id}`, scope `requests:read`). Chemin du
 * rafraîchissement ciblé : quelques demandes d'un courrier, pas le tenant
 * entier. Iris répond 404 sans jamais révéler l'existence d'une demande hors du
 * périmètre de la clé — un 404 ne dit donc pas « supprimée ».
 */
export function getIrisRequest(
  integration: IrisIntegration,
  requestId: string,
): Promise<IrisResponse<{ request?: IrisRequestDto; error?: unknown }>> {
  return callIris(integration, `/v1/requests/${encodeURIComponent(requestId)}`, { method: "GET" });
}
