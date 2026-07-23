import { describe, it, expect } from "vitest";
import "../mocks/supabase";

// P0 #6 du plan de tests QA : la manipulation du bloc signature est du parsing
// HTML fragile — une régression corrompt silencieusement le corps d'une réponse
// officielle lors de la ré-édition (perte de contenu ou signature dupliquée).
const { splitSignatureBlock, stripSignatureBlock } = await import("@/services/courierReplyService");

const IMG = '<img src="sig.png" alt="signature-clara" width="160">';

describe("splitSignatureBlock", () => {
  it("wrapper legacy <div data-signature-block> : extrait le bloc, préserve le contenu", () => {
    const content = "<p>Bonjour,</p><p>Voici la réponse.</p>";
    const sig = '<div data-signature-block="true"><p>Le Maire</p></div>';
    const { content: c, signature: s } = splitSignatureBlock(content + sig);
    expect(c).toBe(content);
    expect(s).toBe(sig);
  });

  it("marqueur courant avec <hr> : coupe au dernier <hr>, signature = ce qui suit", () => {
    const content = "<p>Corps de la réponse.</p>";
    const html = `${content}<hr><p>Le Maire</p>${IMG}`;
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe(content);
    expect(s).toBe(`<p>Le Maire</p>${IMG}`);
  });

  it("retire aussi le paragraphe blanc décoratif précédant le <hr>", () => {
    const content = "<p>Corps.</p>";
    const html = `${content}<p>&nbsp;</p><hr><p>Le Maire</p>${IMG}`;
    const { content: c } = splitSignatureBlock(html);
    expect(c).toBe(content);
  });

  it("plusieurs <hr> : seuls ceux APRÈS le dernier séparateur partent en signature", () => {
    const content = "<p>Partie 1</p><hr><p>Partie 2</p>";
    const html = `${content}<hr><p>Le Maire</p>${IMG}`;
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe(content); // le 1er <hr> (séparateur éditorial) reste dans le contenu
    expect(s).toBe(`<p>Le Maire</p>${IMG}`);
  });

  it("sans <hr> : repli sur le <p> qui enveloppe l'image", () => {
    const content = "<p>Corps.</p>";
    const html = `${content}<p>Le Maire ${IMG}</p>`;
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe(content);
    expect(s).toBe(`<p>Le Maire ${IMG}</p>`);
  });

  it("sans <hr> ni <p> englobant : coupe à l'image même", () => {
    const html = `Texte brut${IMG}`;
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe("Texte brut");
    expect(s).toBe(IMG);
  });

  it("aucune signature : contenu intact (trim final), signature vide", () => {
    const html = "<p>Réponse sans signature.</p>  ";
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe("<p>Réponse sans signature.</p>");
    expect(s).toBe("");
  });

  it("une <img> ordinaire (autre alt) n'est PAS traitée comme signature", () => {
    const html = '<p>Voir la pièce jointe : <img src="plan.png" alt="plan cadastral"></p>';
    const { content: c, signature: s } = splitSignatureBlock(html);
    expect(c).toBe(html);
    expect(s).toBe("");
  });

  it("HTML malformé (balises non fermées) : ne jette pas, reste sans perte", () => {
    const html = "<p>Corps<div>ouvert";
    expect(() => splitSignatureBlock(html)).not.toThrow();
    expect(splitSignatureBlock(html).content).toBe(html);
  });
});

describe("stripSignatureBlock", () => {
  it("est identique au champ content de splitSignatureBlock", () => {
    const cases = [
      `<p>Corps.</p><hr><p>Le Maire</p>${IMG}`,
      `<p>Corps.</p><div data-signature-block="true">sig</div>`,
      "<p>Sans signature</p>",
    ];
    for (const html of cases) {
      expect(stripSignatureBlock(html)).toBe(splitSignatureBlock(html).content);
    }
  });

  it("signer puis retirer rend le corps d'origine (aller-retour sans corruption)", () => {
    const original = "<p>Bonjour,</p><p>Réponse officielle.</p>";
    const signed = `${original}<p>&nbsp;</p><hr><p>Le Maire</p>${IMG}`;
    expect(stripSignatureBlock(signed)).toBe(original);
  });
});
