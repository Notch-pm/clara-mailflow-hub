// Serveur d'envoi du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-smtp-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/smtp`, scope
// `smtp`, contrat public-api 1.1.0). Clara ne fait que recopier ce qu'il
// déclare, et RIEN d'autre : ce module décide seulement si la déclaration est
// exploitable.
//
// Prudence assumée : au moindre doute (`configured: false`, hôte manquant,
// adresse d'expédition qui n'est pas une adresse), on renvoie `null` →
// l'appelant EFFACE le miroir. Clara n'ayant aucun relais de repli, cela
// signifie « ce tenant n'expédie plus » — c'est voulu : un relais à moitié
// configuré ne fait pas partir les mails, il fait échouer des mails
// d'authentification en donnant l'illusion d'une configuration.
//
// Le mot de passe ne fait que traverser ce module, de la réponse HTTP vers la
// RPC de service : il n'apparaît dans aucun journal, aucun compteur, aucun
// message d'avertissement.

/** Tenant Clara et la racine Socle qui porte son relais. */
export interface SmtpTenantRef {
  /** `organizations.id` côté Clara. */
  organizationId: string;
  /** Nom du tenant — pour les avertissements lisibles par un humain. */
  organizationName: string;
  /** Racine Socle du tenant (une sous-organisation n'a pas de relais propre). */
  rootSocleOrgId: string;
}

/** Réponse de `GET /v1/organizations/{id}/smtp` (contrat public Socle). */
export interface SocleSmtpDto {
  organization_id?: string | null;
  configured?: boolean | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  use_tls?: boolean | null;
  updated_at?: string | null;
}

/**
 * Arguments de la RPC de service `sync_smtp_settings_from_socle`.
 * `username`, `password` et `from_name` sont des chaînes (jamais `null`) :
 * les colonnes de `smtp_settings` sont `not null default ''`.
 */
export interface SmtpMirrorArgs {
  p_org_id: string;
  p_socle_org_id: string;
  p_host: string;
  p_port: number;
  p_username: string;
  p_password: string;
  p_from_email: string;
  p_from_name: string;
  p_use_tls: boolean;
  p_socle_updated_at: string | null;
}

export const DEFAULT_SMTP_PORT = 587;

/** Même exigence que la validation serveur (RPC) : une adresse, pas une phrase. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function port(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(trimmed(value), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_SMTP_PORT;
}

/**
 * Déclaration du Socle → arguments de la RPC, ou `null` si le tenant n'a pas de
 * relais exploitable (le miroir doit alors être effacé).
 */
export function smtpMirrorArgs(
  tenant: SmtpTenantRef,
  dto: SocleSmtpDto | null | undefined,
): SmtpMirrorArgs | null {
  if (!dto || dto.configured !== true) return null;
  const host = trimmed(dto.host);
  const fromEmail = trimmed(dto.from_email).toLowerCase();
  if (host === "" || !EMAIL_RE.test(fromEmail)) return null;
  return {
    p_org_id: tenant.organizationId,
    p_socle_org_id: tenant.rootSocleOrgId,
    p_host: host,
    p_port: port(dto.port),
    p_username: trimmed(dto.username),
    // Jamais élagué : une espace peut faire partie du mot de passe.
    p_password: typeof dto.password === "string" ? dto.password : "",
    p_from_email: fromEmail,
    p_from_name: trimmed(dto.from_name),
    // Absent ⇒ chiffrement : une déclaration incomplète ne dégrade jamais
    // silencieusement vers du trafic en clair.
    p_use_tls: dto.use_tls !== false,
    p_socle_updated_at: trimmed(dto.updated_at) || null,
  };
}

/**
 * Avertissement d'un tenant dont le relais n'a pas pu être relu. Journalisé
 * dans `socle_sync_runs.counters.warnings` : il doit dire quoi faire, et ne
 * jamais porter d'identifiant secret.
 */
export function smtpWarning(tenant: SmtpTenantRef, status: number): string {
  const prefix = `serveur d'envoi (${tenant.organizationName})`;
  if (status === 403) {
    return `${prefix} : la clé Socle ne porte pas le scope « smtp » — miroir inchangé.`;
  }
  if (status === 404) {
    return `${prefix} : organisation hors périmètre de la clé, ou API Socle antérieure à la route /smtp — miroir inchangé.`;
  }
  return `${prefix} : réponse ${status} du Socle — miroir inchangé.`;
}

/**
 * Avertissement d'un tenant dont la racine Socle est introuvable dans le
 * périmètre de la clé : sans racine, aucune route à appeler.
 */
export function smtpRootUnknownWarning(organizationName: string, socleOrgId: string): string {
  return `serveur d'envoi (${organizationName}) : racine introuvable pour l'organisation Socle ${socleOrgId} — miroir inchangé.`;
}
