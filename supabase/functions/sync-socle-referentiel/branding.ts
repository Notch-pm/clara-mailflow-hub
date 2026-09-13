// Charte graphique du tenant : correspondance API Socle → miroir Clara.
// Logique pure, testée par Vitest (src/test/socle/socle-branding-mirror.test.ts) —
// aucune dépendance Deno.
//
// Le Socle est la source de vérité (`GET /v1/organizations/{id}/branding`,
// scope `read`). Depuis le 2026-09-13, Clara ne SAISIT plus la charte de la
// collectivité : elle la recopie, comme elle recopie déjà le nom, le slug et le
// serveur d'envoi. Une charte n'a plus qu'un seul endroit où être écrite — deux
// chartes divergentes pour une même collectivité, c'est un mail qui ne
// ressemble pas à son expéditeur.
//
// Le LOGO passe par ici depuis le 2026-09-13 lui aussi. Il arrivait jusque-là
// par `planTenantIdentityUpdate`, qui lit la colonne BRUTE de l'organisation
// mappée : une sous-organisation sans logo propre affichait donc du vide au
// lieu du logo de sa collectivité (« Marie d'Arles » n'en avait aucun). C'est
// exactement ce que la route /branding existe pour éviter. L'identité ne fixe
// plus que le nom et le slug.
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

/**
 * Ce que Clara mirrore de la charte, dans `organizations`.
 *
 * Le Socle en porte CINQ éléments — logo couleur, logo blanc, favicon, deux
 * couleurs. Clara n'en reprend que trois : elle n'a ni fond sombre à habiller
 * ni onglet de navigateur à marquer (le favicon de Clara est celui de Clara,
 * pas celui de la collectivité). Le jour où l'un des deux autres sert, il
 * s'ajoute ici et dans la table — pas avant : une colonne sans lecteur est une
 * colonne qui se périme.
 */
export interface BrandingMirror {
  logo_url: string | null;
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

/**
 * URL de logo servie par le Socle, ou `null`.
 *
 * Chaîne vide ⇒ `null`, comme le sérialiseur du Socle : une colonne vide et une
 * colonne absente disent la même chose (« pas de logo »), les distinguer ferait
 * afficher une image cassée. Aucune validation au-delà — le Socle publie une
 * URL libre, il n'héberge pas le fichier.
 */
export function logoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** Charte applicable déclarée par le Socle, normalisée. */
export function brandingMirror(dto: SocleBrandingDto | null | undefined): BrandingMirror {
  return {
    logo_url: logoUrl(dto?.logo_url),
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
  current: Partial<BrandingMirror>,
  dto: SocleBrandingDto | null | undefined,
): Partial<BrandingMirror> | null {
  const wanted = brandingMirror(dto);
  const fields: Partial<BrandingMirror> = {};
  if ((current.logo_url ?? null) !== wanted.logo_url) {
    fields.logo_url = wanted.logo_url;
  }
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
