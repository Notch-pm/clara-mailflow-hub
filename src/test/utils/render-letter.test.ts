import { describe, expect, it } from "vitest";
import { renderLetterHtml } from "@/utils/printReply";

// L'exemplaire conservé d'un courrier posté et l'impression sortent de la même
// fonction : ce qui est gardé est ce qui est parti.

const BASE = {
  bodyHtml: "<p>Madame, Monsieur,</p><p>Vous êtes conviée.</p>",
  subject: "Réunion de quartier",
  senderName: "Marie Dupont",
  date: "2026-10-13T10:00:00Z",
  organizationName: "Ville d'Évreux",
};

describe("renderLetterHtml", () => {
  it("mise en page standard : document complet, objet, destinataire, corps", () => {
    const html = renderLetterHtml(BASE);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Objet : Réunion de quartier");
    expect(html).toContain('<div class="recipient-line">Marie Dupont</div>');
    expect(html).toContain("<p>Vous êtes conviée.</p>");
    expect(html).toContain("13 octobre 2026");
  });

  it("échappe l'objet et le nom, jamais le corps (HTML de l'éditeur)", () => {
    const html = renderLetterHtml({ ...BASE, subject: "<script>x</script>", senderName: "A & B" });
    expect(html).toContain("Objet : &lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("modèle de l'organisation : variables fusionnées, feuille d'impression de la signature ajoutée", () => {
    const html = renderLetterHtml({
      ...BASE,
      templateHtml: "<html><head></head><body><h1>{{organisation}}</h1>{{usager}} — {{objet}}{{contenu}}</body></html>",
    });
    expect(html).toContain("<h1>Ville d&#x27;Évreux</h1>");
    expect(html).toContain("Marie Dupont — Réunion de quartier<p>Madame, Monsieur,</p>");
    expect(html).toMatch(/<style>[\s\S]*signature-clara[\s\S]*<\/style><\/head>/);
  });
});
