// Charte graphique du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-branding-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/branding`,
// scope `read`). Depuis le 2026-09-13, Clara ne SAISIT plus les couleurs de la
// collectivité : elle les recopie, comme elle recopie déjà le nom, le slug, le
// logo et le serveur d'envoi. Une couleur n'a plus qu'un seul endroit où être
// écrite — deux chartes divergentes pour une même collectivité, c'est un mail
// qui ne ressemble pas à son expéditeur.
//
// ⚠️ L'appel porte sur le `socle_org_id` DU TENANT, pas sur sa racine
// (contrairement au relais SMTP, dont la route n'existe que sur une racine) :
// `/branding` résout lui-même l'héritage (`branding_inherit_parent`), et une
// sous-organisation peut porter sa propre charte. Interroger la racine
// substituerait celle de la collectivité à la sienne.
//
// Miroir strict, l'absence comprise : une couleur retirée du référentiel est
// retirée du miroir. Contrairement au relais SMTP, cela ne casse rien — les
// gabarits de mails ont leurs propres couleurs de repli (`#0acf83`, `#18181b`) ;
// une collectivité qui n'a pas rempli sa charte reçoit l'habillage Clara.

/** Réponse de `GET /v1/organizations/{id}/branding` (contrat public Socle). */
export interface SocleBrandingDto {
  organization_id?: string | null;
  /** Organisation qui porte la charte servie (elle-même, ou l'ancêtre dont elle hérite). */
  source_organization_id?: string | null;
  inherited?: boolean | null;
  configured?: boolean | null;
  logo_url?: string | null;
  logo_white_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
}

/** Les deux seules couleurs mirrorées par Clara (cf. `organizations`). */
export interface BrandingColors {
  primary_color: string | null;
  secondary_color: string | null;
}

/**
 * `#RRGGBB` → `#rrggbb` ; tout le reste → `null`.
 *
 * Même normalisation que le sérialiseur du Socle, refaite ici parce qu'un
 * miroir ne fait pas confiance à sa source sur la forme : la colonne Clara
 * porte une contrainte `^#[0-9a-f]{6}$`, une valeur exotique la ferait échouer
 * au milieu d'une synchronisation. Les couleurs de quartier du Socle sont
 * servies en `hsl(h s% l%)` — assez pour savoir que toutes ses couleurs ne
 * sont pas hexadécimales.
 */
export function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
}

/** Couleurs applicables déclarées par le Socle, normalisées. */
export function brandingColors(dto: SocleBrandingDto | null | undefined): BrandingColors {
  return {
    primary_color: hexColor(dto?.primary_color),
    secondary_color: hexColor(dto?.secondary_color),
  };
}

/**
 * Champs de `organizations` à réécrire, ou `null` si le miroir est déjà aligné
 * (motif `planTenantIdentityUpdate` : on n'écrit que ce qui change).
 *
 * `configured: false` n'est pas traité à part : une charte vide EST une charte,
 * et le miroir doit se vider avec elle.
 */
export function planBrandingUpdate(
  current: Partial<BrandingColors>,
  dto: SocleBrandingDto | null | undefined,
): Partial<BrandingColors> | null {
  const wanted = brandingColors(dto);
  const fields: Partial<BrandingColors> = {};
  if ((current.primary_color ?? null) !== wanted.primary_color) {
    fields.primary_color = wanted.primary_color;
  }
  if ((current.secondary_color ?? null) !== wanted.secondary_color) {
    fields.secondary_color = wanted.secondary_color;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Avertissement d'un tenant dont la charte n'a pas pu être relue. Journalisé
 * dans `socle_sync_runs.counters.warnings` : il doit dire quoi faire.
 */
export function brandingWarning(organizationName: string, status: number): string {
  const prefix = `charte graphique (${organizationName})`;
  if (status === 403) {
    return `${prefix} : la clé Socle ne porte pas le scope « read » — miroir inchangé.`;
  }
  if (status === 404) {
    return `${prefix} : organisation hors périmètre de la clé, ou API Socle antérieure à la route /branding — miroir inchangé.`;
  }
  return `${prefix} : réponse ${status} du Socle — miroir inchangé.`;
}
