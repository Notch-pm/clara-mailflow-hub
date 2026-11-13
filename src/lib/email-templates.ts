/**
 * Modèles de courriels du Socle comme BASE d'un courrier sortant — logique pure, testée
 * (`src/test/lib/email-templates.test.ts`).
 *
 * Contrat du Socle (`docs/features/modeles-courriels.md` côté Socle) : objet et corps en
 * TEXTE BRUT, variables `{{domaine.cle}}` du catalogue UNIQUE de la gamme, sections
 * `{{#cle}}…{{/cle}}` (rendue si la variable a une valeur) et `{{^cle}}…{{/cle}}` (si elle
 * n'en a pas) ; une ligne vide sépare deux paragraphes. Le Socle ne fusionne rien :
 * l'application qui écrit le fait. Moteur repris d'Iris (`renderTemplateText`), pour qu'un
 * même modèle rende le même texte dans les deux applications.
 *
 * Règle reprise d'Iris : une valeur absente ⇒ la clé est OMISE, le jeton devient vide —
 * jamais un mot d'écran de gestion dans une lettre. L'agent est prévenu des trous
 * (`missingVariables`) pour les combler à la main.
 */

export interface EmailTemplate {
  id: string;
  socle_id: string;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  /** Organisations SOCLE où le modèle est proposé, cochées nommément. */
  socle_organization_ids: string[];
  socle_updated_at: string | null;
  synced_at: string;
}

const SECTION_RE = /\{\{\s*([#^])\s*([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/;
const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function hasValue(values: Readonly<Record<string, string>>, key: string): boolean {
  return (values[key] ?? "").trim() !== "";
}

/** Résout les sections seules ; un jeton de section orphelin disparaît. */
function resolveSections(text: string, values: Readonly<Record<string, string>>): string {
  let out = text;
  for (let guard = 0; guard < 200; guard++) {
    const match = SECTION_RE.exec(out);
    if (!match) break;
    const [whole, sigil, key, inner] = match;
    const keep = sigil === "#" ? hasValue(values, key) : !hasValue(values, key);
    out = out.slice(0, match.index) + (keep ? inner : "") + out.slice(match.index + whole.length);
  }
  return out.replace(/\{\{\s*[#^/]\s*[a-zA-Z0-9_.]+\s*\}\}/g, "");
}

/** Rend un texte : sections d'abord, puis variables. Un jeton orphelin disparaît. */
export function renderTemplateText(text: string, values: Readonly<Record<string, string>>): string {
  return resolveSections(text, values).replace(VARIABLE_RE, (_m, key: string) => values[key] ?? "");
}

function tidyBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Texte brut rendu → HTML de l'éditeur : un paragraphe par bloc séparé d'une ligne vide,
 * un saut de ligne simple devient `<br>`. Tout est échappé : une valeur (le nom d'un
 * usager…) ne peut pas injecter de balise.
 */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${p.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("");
}

/**
 * Les variables qui restent vides dans le texte rendu, sans doublon. Une variable placée
 * dans une section écartée (`{{#cle}}…{{/cle}}` sans valeur) n'est pas un trou : le modèle
 * a prévu son absence.
 */
export function missingVariables(
  template: Pick<EmailTemplate, "subject" | "body">,
  values: Readonly<Record<string, string>>,
): string[] {
  const missing: string[] = [];
  const visible = resolveSections(`${template.subject}\n${template.body}`, values);
  for (const m of visible.matchAll(VARIABLE_RE)) {
    const key = m[1];
    if (!hasValue(values, key) && !missing.includes(key)) missing.push(key);
  }
  return missing;
}

/** Un modèle prêt à poser dans l'éditeur : objet sur une ligne, corps en HTML. */
export function applyEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body">,
  values: Readonly<Record<string, string>>,
): { subject: string; bodyHtml: string; missing: string[] } {
  return {
    subject: renderTemplateText(template.subject, values).replace(/\s+/g, " ").trim(),
    bodyHtml: plainTextToHtml(tidyBody(renderTemplateText(template.body, values))),
    missing: missingVariables(template, values),
  };
}

/**
 * Les modèles proposés dans une organisation (identifiant SOCLE) : égalité stricte, pas
 * de descendance — cocher la racine dans le Socle n'ouvre pas ses services.
 */
export function proposedTemplates<T extends Pick<EmailTemplate, "socle_organization_ids">>(
  templates: readonly T[],
  socleOrganizationId: string | null | undefined,
): T[] {
  if (!socleOrganizationId) return [];
  return templates.filter((t) => t.socle_organization_ids.includes(socleOrganizationId));
}

/**
 * Les organisations du tenant où un modèle est proposé, triées par nom. Un organisme
 * coché dans le Socle mais hors du miroir du tenant (autre branche, obsolète) est ignoré.
 */
export function organizationNamesFor(
  template: Pick<EmailTemplate, "socle_organization_ids">,
  organizations: readonly { socle_id: string; name: string; obsoleted_at?: string | null }[],
): string[] {
  const byId = new Map(
    organizations.filter((o) => !o.obsoleted_at).map((o) => [o.socle_id, o.name] as const),
  );
  return template.socle_organization_ids
    .map((id) => byId.get(id))
    .filter((name): name is string => !!name)
    .sort((a, b) => a.localeCompare(b, "fr"));
}

// ─── Valeurs des variables pour un courrier ─────────────────────────────────

/** Ce que Clara sait d'un courrier sortant au moment d'y poser un modèle. */
export interface EmailTemplateContext {
  /** Destinataire (l'expéditeur du courrier reçu, pour une réponse). */
  recipient: {
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    /** Raison sociale (personne morale). */
    organization?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  } | null;
  /** Le dossier : le courrier reçu pour une réponse, le sortant lui-même sinon. */
  dossier: {
    reference?: string | null;
    subject?: string | null;
    receivedAt?: string | null;
    channel?: string | null;
    status?: string | null;
  } | null;
  /** Organisation émettrice (gestionnaire). */
  serviceName?: string | null;
  /** L'agent qui rédige. */
  agentName?: string | null;
  /** La collectivité. */
  organizationName?: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  paper: "Courrier",
  email: "Courriel",
  portal: "Formulaire en ligne",
  guichet: "Guichet",
  relaye_elu: "Relayé par un élu",
  relaye_agent: "Relayé par un agent",
};

/** « 21 août 2026 » — la forme des exemples du catalogue. */
export function formatTemplateDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** Valeur absente ⇒ clé omise. */
function present(values: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

/**
 * Les valeurs du catalogue commun du Socle que Clara sait remplir. La civilité n'est pas
 * connue de Clara (elle vit dans la fiche du référentiel) : `usager.civilite` reste vide et
 * `usager.salutation` prend la forme de repli du catalogue, « Madame, Monsieur ».
 */
export function emailTemplateValues(ctx: EmailTemplateContext): Record<string, string> {
  const r = ctx.recipient;
  const first = r?.first_name?.trim() || "";
  const last = r?.last_name?.trim() || "";
  const person = `${first} ${last}`.trim();
  const company = r?.organization?.trim() || "";
  const fullName = person || r?.name?.trim() || company;
  const d = ctx.dossier;
  return present({
    "usager.salutation": "Madame, Monsieur",
    "usager.prenom": first,
    "usager.nom": last || (person ? "" : r?.name),
    "usager.nom_complet": fullName,
    "usager.raison_sociale": company,
    "usager.courriel": r?.email,
    "usager.telephone": r?.phone,
    "usager.adresse": r?.address,
    "demande.reference": d?.reference,
    "demande.objet": d?.subject,
    "demande.date_depot": formatTemplateDate(d?.receivedAt),
    "demande.canal": d?.channel ? CHANNEL_LABELS[d.channel] ?? null : null,
    "demande.statut": d?.status,
    "demande.destinataire": ctx.serviceName,
    "agent.nom": ctx.agentName,
    "organisation.nom": ctx.organizationName,
  });
}
