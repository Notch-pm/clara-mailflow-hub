// Cadre des e-mails de la gamme — LOGIQUE PURE (aucune dépendance Deno, aucun
// réseau), testée par vitest.
//
// LE DESSIN (validé le 2026-09-24, identique dans Iris, Clara et le Socle) :
//   • une colonne centrée de 520 px, fond BLANC, bordée de 1 px de la couleur
//     principale, arrondie aux QUATRE coins (16 px) ;
//   • un bandeau BLANC portant le logo centré (le nom à défaut), séparé du
//     corps par un filet de 1 px de la couleur principale. Plus d'aplat de
//     couleur : il entrait en collision avec le logo ;
//   • titre, corps, bouton plein de la couleur principale, lien de repli
//     cliquable, filet gris, nom de l'organisation en pied.
//
// ⚠️ OUTLOOK POUR WINDOWS (moteur Word) ignore `border-radius` : la colonne y
// sortait à coins carrés. Elle y est donc dessinée en VML (`v:roundrect`, dans
// des commentaires conditionnels `[if mso]`), et la bordure CSS de la table y
// est retirée — sinon Outlook tracerait deux cadres l'un dans l'autre. Tous
// les autres clients ignorent ces commentaires.
//
// ⚠️ Styles INLINE et couleurs hexadécimales uniquement : Gmail supprime les
// <style>, aucun client ne lit `var()`. Tout ce qui vient de la base (nom,
// URL) est échappé ici ; `bodyHtml` est du HTML déjà composé par l'appelant.

export const EMAIL_INK = "#18181b";
export const EMAIL_TEXT = "#52525b";
export const EMAIL_MUTED = "#a1a1aa";
export const EMAIL_RULE = "#e4e4e7";
export const EMAIL_LINK = "#2563eb";
export const EMAIL_FONT = "Arial,Helvetica,sans-serif";
export const CARD_WIDTH = 520;
export const CARD_RADIUS = 16;

export interface BrandedEmail {
  /** Couleur principale de la charte (`#rrggbb`) : bordure, filet, bouton. */
  primary: string;
  /** Nom de l'organisation : bandeau (sans logo), alt du logo, pied. */
  siteName: string;
  /** Logo COULEUR (le bandeau est blanc). Ignoré s'il n'est pas http(s). */
  logoUrl?: string | null;
  /** Titre, en texte brut. */
  heading: string;
  /** Corps, en HTML déjà composé (paragraphes stylés par l'appelant). */
  bodyHtml: string;
  /** Bouton d'action (avec lien de repli), OU code à recopier, OU rien. */
  action?: { label: string; url: string } | { code: string; background?: string | null };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Seul du http(s) entre dans un `href` ou un `src`. */
export function httpUrl(value: string | null | undefined): string | null {
  const url = (value ?? "").trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** `#6B5EA8` → `#6b5ea8` ; toute autre saisie → la couleur de repli. */
export function hexOr(value: string | null | undefined, fallback: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec((value ?? "").trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Texte du bouton : blanc tant qu'il tient 3:1 (AA grand texte), sinon encre sombre. */
export function inkOn(background: string): string {
  return 1.05 / (luminance(background) + 0.05) >= 3 ? "#ffffff" : EMAIL_INK;
}

function headerHtml(e: BrandedEmail, name: string): string {
  const logo = httpUrl(e.logoUrl);
  if (logo) {
    // La hauteur en attribut ET en style : Outlook ignore l'un, d'autres l'autre.
    return `<img src="${escapeHtml(logo)}" alt="${name}" height="48" style="display:inline-block;height:48px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none;" />`;
  }
  return `<p style="margin:0;font-family:${EMAIL_FONT};font-size:20px;font-weight:700;line-height:1.3;color:${EMAIL_INK};">${name}</p>`;
}

function actionHtml(e: BrandedEmail, primary: string): { block: string; fallback: string } {
  const action = e.action;
  if (!action) return { block: "", fallback: "" };
  if ("code" in action) {
    const bg = hexOr(action.background, "#f4f4f5");
    return {
      block: `<div style="margin:8px 0 0;padding:16px;background-color:${bg};border-radius:8px;text-align:center;font-family:${EMAIL_FONT};font-size:28px;font-weight:700;letter-spacing:4px;color:${EMAIL_INK};">${escapeHtml(action.code)}</div>`,
      fallback: "",
    };
  }
  const href = escapeHtml(httpUrl(action.url) ?? "#");
  const shown = escapeHtml(action.url.trim());
  return {
    block: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 0;">
            <tr><td align="center" style="background-color:${primary};border-radius:8px;">
              <a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 32px;font-family:${EMAIL_FONT};font-size:15px;font-weight:700;color:${inkOn(primary)};text-decoration:none;border-radius:8px;">${escapeHtml(action.label)}</a>
            </td></tr>
          </table>`,
    fallback: `<p style="margin:0 0 20px;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${EMAIL_MUTED};word-break:break-all;">Si le bouton ne fonctionne pas, copiez ce lien : <a href="${href}" target="_blank" rel="noopener" style="color:${EMAIL_LINK};text-decoration:underline;">${shown}</a></p>`,
  };
}

/** Rend le document HTML complet. */
export function renderBrandedEmail(e: BrandedEmail): string {
  const primary = hexOr(e.primary, EMAIL_INK);
  const name = escapeHtml(e.siteName.trim() || "Edilumen");
  const { block, fallback } = actionHtml(e, primary);
  // arcsize VML : rayon rapporté au plus petit côté (la largeur ici, ~520 px
  // de haut au moins) — 3 % ≈ 16 px.
  const arc = `${Math.round((CARD_RADIUS / CARD_WIDTH) * 100)}%`;

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(e.heading)}</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:${EMAIL_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" arcsize="${arc}" strokecolor="${primary}" strokeweight="1px" fillcolor="#ffffff" style="width:${CARD_WIDTH}px;v-text-anchor:top;"><v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true"><table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${CARD_WIDTH}px;"><![endif]-->
        <!--[if !mso]><!--><table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${CARD_WIDTH}px;max-width:100%;border-collapse:separate;border-spacing:0;background-color:#ffffff;border:1px solid ${primary};border-radius:${CARD_RADIUS}px;"><!--<![endif]-->
          <tr>
            <td align="center" style="padding:28px 32px 24px;border-bottom:1px solid ${primary};border-radius:${CARD_RADIUS}px ${CARD_RADIUS}px 0 0;">
              ${headerHtml(e, name)}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 28px;font-family:${EMAIL_FONT};">
              <h1 style="margin:0 0 16px;font-family:${EMAIL_FONT};font-size:22px;line-height:1.3;font-weight:700;color:${EMAIL_INK};">${escapeHtml(e.heading)}</h1>
              ${e.bodyHtml}
              ${block}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;font-family:${EMAIL_FONT};">
              ${fallback}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${EMAIL_RULE};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>
              <p style="margin:16px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;font-weight:700;color:${EMAIL_MUTED};text-align:center;">${name}</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></v:textbox></v:roundrect><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
