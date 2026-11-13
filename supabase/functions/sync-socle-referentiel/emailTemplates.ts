// Modèles de courriels du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-email-templates-mirror.test.ts)
// — aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/email-templates?organization_id=
// <racine>&application=clara`, public-api ≥ 1.45.0). Clara recopie, et ne garde
// que ce qu'il sait servir comme BASE de rédaction : les modèles CRÉÉS de SA
// racine, cochés pour `clara`, avec un titre, un objet et un corps. Les
// courriels système (messages automatiques d'Iris) sont écartés. Un modèle
// malformé est écarté, jamais réparé.

/** Un élément de `GET /v1/email-templates` (contrat public Socle 1.45.0). */
export interface SocleEmailTemplateDto {
  id?: string | null;
  key?: string | null;
  organization_id?: string | null;
  name?: string | null;
  description?: string | null;
  subject?: string | null;
  body?: string | null;
  applications?: string[] | null;
  organization_ids?: string[] | null;
  is_system?: boolean | null;
  updated_at?: string | null;
}

/** Ce que reçoit la RPC de service `sync_email_templates_from_socle` (`p_templates`). */
export interface EmailTemplateMirrorRow {
  socle_id: string;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  socle_organization_ids: string[];
  socle_updated_at: string | null;
}

export const CLARA_APPLICATION = "clara";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Les lignes du miroir d'UN tenant, dont la racine Socle est `rootSocleId`.
 * `null` si la réponse n'est pas une liste (Socle trop ancien, réponse
 * inattendue) : l'appelant garde alors le miroir en l'état plutôt que de
 * l'effacer sur un malentendu.
 */
export function emailTemplateMirrorRows(
  rootSocleId: string,
  payload: unknown,
): EmailTemplateMirrorRow[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: EmailTemplateMirrorRow[] = [];
  const seen = new Set<string>();
  for (const raw of payload as SocleEmailTemplateDto[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.organization_id !== rootSocleId) continue;
    // Courriel système : message automatique d'une application, pas une base.
    if (raw.is_system === true || text(raw.key)) continue;
    if (!strings(raw.applications).includes(CLARA_APPLICATION)) continue;
    const id = typeof raw.id === "string" && UUID_RE.test(raw.id) ? raw.id : null;
    const name = text(raw.name);
    const subject = text(raw.subject);
    const body = text(raw.body);
    if (!id || !name || !subject || !body || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      socle_id: id,
      name: name.trim(),
      description: text(raw.description)?.trim() ?? null,
      subject,
      body,
      // Pas de descendance implicite : seuls les organismes cochés nommément.
      socle_organization_ids: Array.from(
        new Set(strings(raw.organization_ids).filter((v) => UUID_RE.test(v))),
      ).sort(),
      socle_updated_at: text(raw.updated_at),
    });
  }
  return rows;
}

/** Avertissement d'une lecture refusée : le miroir reste en l'état. */
export function emailTemplatesWarning(tenantName: string, status: number): string {
  if (status === 404) {
    return `modèles de courriels (${tenantName}) : le Socle ne sert pas /v1/email-templates pour cette racine (public-api ≥ 1.45.0) — miroir inchangé.`;
  }
  if (status === 403) {
    return `modèles de courriels (${tenantName}) : la clé API du Socle n'a pas le droit de lecture requis (403) — miroir inchangé.`;
  }
  return `modèles de courriels (${tenantName}) : le Socle répond ${status} — miroir inchangé.`;
}
