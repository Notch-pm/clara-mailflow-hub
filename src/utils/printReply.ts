import Handlebars from "handlebars";

export interface PrintReplyOptions {
  bodyHtml: string;
  subject: string | null;
  /** Usager : nom d'usage complet (ex-« expéditeur »). */
  senderName: string | null;
  senderFirstName?: string | null;
  senderLastName?: string | null;
  /** Bloc usager : nom, organisme, adresse, téléphone, courriel. */
  senderCompleteHtml?: string | null;
  date: string | null;
  organizationName?: string | null;
  organizationCompleteHtml?: string | null;
  serviceName?: string | null;
  serviceCompleteHtml?: string | null;
  templateHtml?: string | null;
  /** Bloc signature (nom, titre, image) rendu via la variable {{signature}} du modèle. */
  signatureHtml?: string | null;
}

/**
 * Coordonnées d'un correspondant, dans les TROIS formes qu'elles prennent
 * selon la table d'origine — un même bloc doit savoir les rendre toutes :
 *
 * - `organizations` (le tenant) : adresse **décomposée** en colonnes ;
 * - `socle_organizations` (le référentiel) : adresse en **texte libre**, et le
 *   courriel s'appelle `email` ;
 * - `courier_participants` (l'usager) : texte libre également, plus l'organisme
 *   qu'il représente.
 *
 * L'oubli de ce détail est ce qui vidait `{{{service_complete}}}` : on lui
 * passait une ligne du référentiel, dont AUCUN champ ne portait le nom attendu
 * — le bloc se réduisait au nom, sans erreur visible.
 */
export interface ContactInfo {
  // Forme décomposée (organizations)
  address_street?: string | null;
  address_complement?: string | null;
  address_postal_code?: string | null;
  address_city?: string | null;
  contact_email?: string | null;
  website?: string | null;
  // Forme texte libre (socle_organizations, courier_participants)
  address?: string | null;
  email?: string | null;
  /** Organisme représenté par un usager (société, association…). */
  organization?: string | null;
  phone?: string | null;
}

/**
 * Découpe une adresse en texte libre en lignes postales.
 *
 * Le référentiel sert « 12 rue de la Mare à Jouy, 27120 Douains » sur une
 * seule ligne : la rendre telle quelle donnerait une adresse en pavé. On coupe
 * donc aux retours à la ligne existants ET aux virgules, ce qui reconstitue le
 * bloc attendu sur les adresses réelles du référentiel.
 */
function addressLines(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function buildContactBlock(name: string | null | undefined, info: ContactInfo | null | undefined): string {
  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines: string[] = [];
  if (name) lines.push(`<strong>${esc(name)}</strong>`);
  if (info) {
    if (info.organization && info.organization !== name) lines.push(esc(info.organization));

    // Colonnes décomposées d'abord ; le texte libre ne sert qu'à défaut, jamais
    // en plus — les deux ensemble écriraient l'adresse deux fois.
    const structured: string[] = [];
    if (info.address_street) structured.push(esc(info.address_street));
    if (info.address_complement) structured.push(esc(info.address_complement));
    const cityLine = [info.address_postal_code, info.address_city].filter(Boolean).join(" ").trim();
    if (cityLine) structured.push(esc(cityLine));
    if (structured.length > 0) {
      lines.push(...structured);
    } else if (info.address?.trim()) {
      lines.push(...addressLines(info.address).map(esc));
    }

    if (info.phone) lines.push(`Tél : ${esc(info.phone)}`);
    if (info.website) lines.push(`Web : ${esc(info.website)}`);
    const mail = info.contact_email || info.email;
    if (mail) lines.push(`Email : ${esc(mail)}`);
  }
  return lines.join("<br>");
}

/**
 * Taille de la signature manuscrite à l'impression.
 *
 * ⚠️ `!important` est indispensable : l'image porte un `style=` EN LIGNE
 * (`max-width:200px;max-height:80px`, posé par `buildSignedBody`), qui l'emporte
 * sur toute feuille de style. Sans lui, la règle ci-dessous ne s'appliquait
 * jamais — y compris dans la mise en page standard, où elle existait pourtant
 * depuis toujours et n'a donc jamais rien contraint.
 *
 * Le sélecteur n'est PAS limité à `.letter-body` : dans un modèle d'organisation
 * la signature arrive par la variable `{{signature}}`, n'importe où dans la
 * maquette. C'est ce qui la laissait à sa taille brute — 200 px de large à côté
 * d'un corps en 14 px, contre 12 pt dans la mise en page standard : la même
 * image y paraît nettement plus grosse.
 *
 * Pour l'ajuster, il n'y a qu'ici à toucher.
 */
export const SIGNATURE_PRINT_CSS = `
    img[alt="signature-clara"] {
      display: block;
      max-width: 45mm !important;
      max-height: 18mm !important;
      width: auto !important;
      height: auto !important;
      margin-top: 0.5em;
    }`;

/**
 * Glisse la feuille de style d'impression dans un modèle d'organisation.
 * Avant `</head>` s'il y en a un ; en tête du document sinon — un modèle
 * Unlayer est un document complet, mais rien ne l'impose.
 */
export function withPrintCss(html: string, css: string): string {
  const style = `<style>${css}\n  </style>`;
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose !== -1) {
    return html.slice(0, headClose) + style + html.slice(headClose);
  }
  return style + html;
}

const LETTER_BODY_CSS = `
    .letter-body p { margin: 0.6em 0; }
    .letter-body h2 { font-size: 14pt; font-weight: bold; margin: 1em 0 0.5em; }
    .letter-body h3 { font-size: 13pt; font-weight: bold; margin: 0.8em 0 0.4em; }
    .letter-body ul, .letter-body ol { padding-left: 1.5em; margin: 0.5em 0; }
    .letter-body hr { border: none; border-top: 1px solid #ccc; margin: 1em 0; }${SIGNATURE_PRINT_CSS}
    .letter-body img:not([alt="signature-clara"]) { max-width: 100%; height: auto; page-break-inside: avoid; }
    h2, h3 { page-break-after: avoid; }
    img { page-break-inside: avoid; }`;

function formatDate(dateStr: string | null): string {
  return dateStr
    ? new Date(dateStr).toLocaleDateString("fr-FR", { dateStyle: "long" })
    : new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });
}

function escape(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openAndPrint(printWin: Window, html: string): void {
  const triggerPrint = () => {
    try {
      printWin.focus();
      printWin.print();
      printWin.addEventListener("afterprint", () => printWin.close());
    } catch {
      /* popup may have been closed manually */
    }
  };

  // Register before writing so we don't miss the load event
  printWin.addEventListener("load", triggerPrint, { once: true });

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();

  // Fallback: if the document is already complete (synchronous content with no
  // external resources), the load event may not fire — trigger after images settle.
  const fallback = () => {
    if (printWin.closed) return;
    const imgs = Array.from(printWin.document.images || []);
    const pending = imgs.filter((img) => !img.complete);
    if (pending.length === 0) {
      triggerPrint();
      return;
    }
    let remaining = pending.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) triggerPrint();
    };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
  };
  setTimeout(fallback, 100);
}

/**
 * Variables offertes à un modèle d'organisation.
 *
 * ⚠️ **`expediteur` reste servi et le restera.** Le terme a été jugé confus et
 * l'éditeur ne propose plus que « Usager », mais les modèles déjà enregistrés
 * contiennent `{{expediteur}}` : le retirer du contexte ne lèverait aucune
 * erreur, il imprimerait un blanc à la place du nom. Un alias coûte une ligne,
 * un courrier au destinataire vide coûte un envoi.
 */
export function mergeContext(
  options: PrintReplyOptions,
  dateStr: string,
): Record<string, unknown> {
  const usager = options.senderName ?? "";
  return {
    date: dateStr,
    objet: options.subject ?? "",
    contenu: new Handlebars.SafeString(options.bodyHtml),
    signature: new Handlebars.SafeString(options.signatureHtml ?? ""),
    usager,
    usager_prenom: options.senderFirstName ?? "",
    usager_nom: options.senderLastName ?? "",
    usager_complete: new Handlebars.SafeString(options.senderCompleteHtml ?? ""),
    // Alias historique — voir le commentaire ci-dessus.
    expediteur: usager,
    organisation: options.organizationName ?? "",
    organisation_complete: new Handlebars.SafeString(options.organizationCompleteHtml ?? ""),
    service: options.serviceName ?? "",
    service_complete: new Handlebars.SafeString(options.serviceCompleteHtml ?? ""),
  };
}

export function printReply(options: PrintReplyOptions): void {
  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) throw new Error("La fenêtre d'impression a été bloquée par le navigateur. Autorisez les popups pour ce site.");

  const dateStr = formatDate(options.date);

  if (options.templateHtml) {
    const compiled = Handlebars.compile(options.templateHtml);
    const merged = compiled(mergeContext(options, dateStr));
    openAndPrint(printWin, withPrintCss(merged, SIGNATURE_PRINT_CSS));
    return;
  }

  // Standard layout (no template)
  openAndPrint(printWin, `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${escape(options.subject) || "Réponse"}</title>
  <style>
    @page { size: A4; margin: 2.5cm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.6; color: #000; background: white; margin: 0; }
    .org-name { font-weight: bold; font-size: 13pt; }
    .date-line { text-align: right; margin-top: 1em; font-size: 11pt; }
    .recipient-line { margin-top: 2em; }
    .letter-subject { font-weight: bold; margin: 1.5em 0; text-decoration: underline; }${LETTER_BODY_CSS}
  </style>
</head>
<body>
  <div class="letter-header">
    ${options.organizationName ? `<div class="org-name">${escape(options.organizationName)}</div>` : ""}
    <div class="date-line">${dateStr}</div>
    ${options.senderName ? `<div class="recipient-line">${escape(options.senderName)}</div>` : ""}
  </div>
  ${options.subject ? `<div class="letter-subject">Objet : ${escape(options.subject)}</div>` : ""}
  <div class="letter-body">${options.bodyHtml}</div>
</body>
</html>`);
}
