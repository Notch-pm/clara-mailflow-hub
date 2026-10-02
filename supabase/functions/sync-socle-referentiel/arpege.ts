// Configuration Arpège du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-arpege-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/integrations/arpege`,
// scope `integrations`, contrat public-api 1.34.0). Clara recopie ce qu'il
// déclare dans `organization_integrations` (provider `arpege`), que les quatre
// fonctions Arpège lisent sans changement.
//
// ⚠️ TRANSITION, à la différence du SMTP : une déclaration absente ou
// incomplète (`configured: false`) NE vide PAS le miroir — on renvoie `null`
// et l'appelant laisse la ligne locale en l'état. Les configurations saisies
// dans Clara avant la bascule (ACCM) survivent ainsi jusqu'à ce que le Socle
// en déclare une.
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
 * rien d'exploitable (le miroir est alors laissé EN L'ÉTAT — transition).
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
