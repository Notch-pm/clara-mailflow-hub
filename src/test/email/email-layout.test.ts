import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  hexOr,
  inkOn,
  renderBrandedEmail,
  type BrandedEmail,
} from "../../../supabase/functions/_shared/emailLayout";

const base: BrandedEmail = {
  primary: "#6b5ea8",
  siteName: "Mairie de Rosny-sous-Bois",
  logoUrl: "https://rosny.fr/logo.png",
  heading: "Réinitialisation de mot de passe",
  bodyHtml: "<p>Bonjour Nathalie Lélue,</p>",
  action: { label: "Réinitialiser le mot de passe", url: "https://clara.edilumen.fr/reset?token_hash=abc&type=recovery" },
};

describe("le cadre des e-mails", () => {
  const html = renderBrandedEmail(base);

  it("borde la colonne de 1 px de la couleur principale, arrondie aux quatre coins", () => {
    expect(html).toContain("border:1px solid #6b5ea8;border-radius:16px;");
  });

  it("garde le bandeau BLANC, séparé du corps par un filet de la couleur principale", () => {
    expect(html).toContain("border-bottom:1px solid #6b5ea8;");
    expect(html).not.toMatch(/background-color:#6b5ea8;padding/);
    expect(html).not.toContain("box-shadow");
  });

  it("dessine l'arrondi en VML pour Outlook, sans doubler la bordure", () => {
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('strokecolor="#6b5ea8"');
    expect(html).toContain("<!--[if !mso]><!--><table");
  });

  it("centre le logo, avec le nom en alt — il n'est écrit nulle part ailleurs dans le bandeau", () => {
    expect(html).toContain('src="https://rosny.fr/logo.png" alt="Mairie de Rosny-sous-Bois"');
  });

  it("écrit le nom en encre sombre quand il n'y a pas de logo", () => {
    const sans = renderBrandedEmail({ ...base, logoUrl: null });
    expect(sans).not.toContain("<img");
    expect(sans).toContain("font-size:20px;font-weight:700;line-height:1.3;color:#18181b;\">Mairie de Rosny-sous-Bois");
  });

  it("remplit le bouton de la couleur principale et rend le lien de repli cliquable", () => {
    expect(html).toContain("background-color:#6b5ea8;border-radius:8px;");
    expect(html).toContain('copiez ce lien : <a href="https://clara.edilumen.fr/reset?token_hash=abc&amp;type=recovery"');
  });

  it("affiche un code sans bouton ni lien de repli", () => {
    const otp = renderBrandedEmail({ ...base, action: { code: "482913" } });
    expect(otp).toContain("482913");
    expect(otp).not.toContain("Si le bouton ne fonctionne pas");
  });

  it("échappe le nom, le titre et les URL — ce sont des données, pas du HTML", () => {
    const hostile = renderBrandedEmail({
      ...base,
      siteName: "<script>x</script>",
      logoUrl: 'https://a.fr/l.png" onerror="alert(1)',
      action: { label: "Ouvrir", url: "javascript:alert(1)" },
    });
    expect(hostile).not.toContain("<script>x</script>");
    expect(hostile).not.toContain('onerror="alert(1)"');
    expect(hostile).toContain('href="#"');
  });

  it("retombe sur une couleur sûre quand la charte n'est pas un hexadécimal", () => {
    expect(hexOr("#6B5EA8", "#000000")).toBe("#6b5ea8");
    expect(hexOr("red;background:url(x)", "#18181b")).toBe("#18181b");
    expect(hexOr(null, "#0acf83")).toBe("#0acf83");
  });

  it("met du texte sombre sur un bouton clair, du blanc sur un bouton foncé", () => {
    expect(inkOn("#6b5ea8")).toBe("#ffffff");
    expect(inkOn("#ffd166")).toBe("#18181b");
  });

  it("échappe les cinq caractères dangereux", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
