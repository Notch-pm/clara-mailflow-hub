// Configuration Arpège du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-arpege-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/integrations/arpege`,
// scope `integrations`, contrat public-api 1.34.0). Clara recopie ce qu'il
// déclare dans `organization_integrations` (provider `arpege`), que les quatre
// fonctions Arpège lisent sans changement.
//
// Le Socle fait foi, sans règle de transition (retirée le 2026-10-02) :
// une réponse 200 sans déclaration exploitable (`configured: false`, ou
// incomplète) SUSPEND la ligne recopiée — `is_active = false`, identifiants
// CONSERVÉS, à la différence du SMTP qui efface son miroir : une interface
// Arpège suspendue continue de suivre les demandes déjà déposées (décision PO
// L5, docs/partenaires-integration.md §5). Seule une réponse non-200 (403, 404,
// 5xx) laisse la ligne en l'état, avec un avertissement.
//
// Les secrets ne font que traverser ce module, de la réponse HTTP vers la RPC
// de service : ils n'apparaissent dans aucun journal, aucun compteur, aucun
// avertissement.

/** Tenant Clara et la racine Socle qui porte sa configuration. */
export interface ArpegeTenantRef {
  /** `organizations.id` côté Clara. */
  organizationId: string;
  /** Nom du tenant — pour les avertissements lisibles par un humain. */
  organizationName: string;
  /** Racine Socle du tenant (une intégration se configure sur la racine). */
  rootSocleOrgId: string;
}

/** Réponse de `GET /v1/organizations/{id}/integrations/arpege` (contrat public Socle). */
export interface SocleIntegrationDto {
  integration?: string | null;
  configured?: boolean | null;
  is_active?: boolean | null;
  settings?: Record<string, unknown> | null;
  secrets?: Record<string, unknown> | null;
  updated_at?: string | null;
}

/** Arguments de la RPC de service `sync_arpege_integration_from_socle`. */
export interface ArpegeMirrorArgs {
  p_org_id: string;
  p_socle_org_id: string;
  p_api_base_url: string;
  p_api_url_ticketingapp: string | null;
  p_client_id: string | null;
  p_client_secret: string | null;
  p_access_token: string | null;
  p_is_active: boolean;
  p_socle_updated_at: string | null;
}

function text(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key];
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

/**
 * Déclaration du Socle → arguments de la RPC, ou `null` si le Socle ne déclare
 * rien d'exploitable (voir `arpegePlan` : la ligne est alors suspendue).
 *
 * Exploitable = `configured`, une URL d'API, et de quoi signer en Hawk (même
 * règle que `resolveHawkCredentials` : identifiant ET clé, le jeton suppléant
 * l'un ou l'autre).
 */
export function arpegeMirrorArgs(
  tenant: ArpegeTenantRef,
  dto: SocleIntegrationDto | null | undefined,
): ArpegeMirrorArgs | null {
  if (!dto || dto.configured !== true) return null;
  const apiBaseUrl = text(dto.settings, "api_base_url");
  const clientId = text(dto.settings, "client_id");
  // Jamais élagués : une espace peut faire partie d'un secret.
  const clientSecret = text(dto.secrets, "client_secret");
  const accessToken = text(dto.secrets, "access_token");
  if (!apiBaseUrl) return null;
  if (!(clientId || accessToken) || !(clientSecret || accessToken)) return null;
  return {
    p_org_id: tenant.organizationId,
    p_socle_org_id: tenant.rootSocleOrgId,
    p_api_base_url: apiBaseUrl.trim(),
    p_api_url_ticketingapp: text(dto.settings, "api_url_ticketingapp")?.trim() ?? null,
    p_client_id: clientId?.trim() ?? null,
    p_client_secret: clientSecret,
    p_access_token: accessToken,
    // Absent ⇒ inactive : on n'active jamais une interface sur une réponse ambiguë.
    p_is_active: dto.is_active === true,
    p_socle_updated_at: typeof dto.updated_at === "string" && dto.updated_at !== "" ? dto.updated_at : null,
  };
}

/** Ce que la sync fait de la ligne Arpège d'un tenant après une réponse 200 du Socle. */
export type ArpegePlan =
  | { action: "recopier"; args: ArpegeMirrorArgs }
  /**
   * Suspendre la ligne recopiée (RPC `suspend_arpege_integration_from_socle`),
   * identifiants conservés. `warning` n'est renseigné que si le Socle se dit
   * configuré mais que sa déclaration est inexploitable — un `configured: false`
   * est un état normal, pas une anomalie.
   */
  | { action: "suspendre"; warning: string | null };

/** Réponse 200 du Socle → recopier, ou suspendre (fin de la transition). */
export function arpegePlan(
  tenant: ArpegeTenantRef,
  dto: SocleIntegrationDto | null | undefined,
): ArpegePlan {
  const args = arpegeMirrorArgs(tenant, dto);
  if (args) return { action: "recopier", args };
  const warning =
    dto?.configured === true
      ? `Arpège (${tenant.organizationName}) : le Socle déclare une configuration incomplète (URL d'API ou identifiants Hawk manquants) — interface suspendue, identifiants conservés.`
      : null;
  return { action: "suspendre", warning };
}

/**
 * Avertissement d'un tenant dont la configuration n'a pas pu être relue.
 * Journalisé dans `socle_sync_runs.counters.warnings` : il doit dire quoi
 * faire, et ne jamais porter d'identifiant secret.
 */
export function arpegeWarning(tenant: ArpegeTenantRef, status: number): string {
  const prefix = `Arpège (${tenant.organizationName})`;
  if (status === 403) {
    return `${prefix} : la clé Socle ne porte pas le scope « integrations » — configuration locale inchangée.`;
  }
  if (status === 404) {
    return `${prefix} : organisation hors périmètre de la clé, ou API Socle antérieure à la route /integrations — configuration locale inchangée.`;
  }
  return `${prefix} : réponse ${status} du Socle — configuration locale inchangée.`;
}
