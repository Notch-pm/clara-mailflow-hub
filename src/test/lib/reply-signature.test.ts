import "../mocks/supabase";
import { describe, expect, it } from "vitest";
import { appendSignature, buildSignatureBlock, escapeHtml } from "@/lib/reply-signature";

/**
 * NON-RÉGRESSION. Ce bloc était écrit dans `ReplyComposer`; l'espace élu le
 * réutilise pour signer à l'identique. La chaîne attendue est figée ici : si
 * elle bouge, les courriers signés depuis le téléphone cessent de ressembler à
 * ceux signés depuis l'ordinateur — sans que rien n'échoue.
 */

const DATA_URL = "data:image/png;base64,AAAA";

describe("buildSignatureBlock", () => {
  it("produit exactement le bloc historique, titre compris", () => {
    expect(
      buildSignatureBlock({
        fullName: "Laurent Saillard",
        title: "Vice-président",
        signatureDataUrl: DATA_URL,
      }),
    ).toBe(
      "<p>&nbsp;</p><hr>" +
        "<p><strong>Laurent Saillard</strong></p>" +
        "<p><em>Vice-président</em></p>" +
        `<p><img src="${DATA_URL}" alt="signature-clara" style="max-width:200px;max-height:80px;" /></p>`,
    );
  });

  it("omet le paragraphe de titre quand il n'y en a pas", () => {
    const block = buildSignatureBlock({ fullName: "A B", title: null, signatureDataUrl: DATA_URL });
    expect(block).not.toContain("<em>");
    expect(block).toBe(
      "<p>&nbsp;</p><hr><p><strong>A B</strong></p>" +
        `<p><img src="${DATA_URL}" alt="signature-clara" style="max-width:200px;max-height:80px;" /></p>`,
    );
  });

  it("échappe le nom et le titre : ils viennent d'un champ libre", () => {
    const block = buildSignatureBlock({
      fullName: 'Jean <script>alert("x")</script>',
      title: "Maire & adjoint",
      signatureDataUrl: DATA_URL,
    });
    expect(block).toContain("Jean &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(block).toContain("<em>Maire &amp; adjoint</em>");
    expect(block).not.toContain("<script>");
  });

  it("garde le marqueur que `stripSignatureBlock` sait retrouver", () => {
    // Changer cet attribut rendrait toute signature précédente indétachable.
    expect(buildSignatureBlock({ fullName: "A", title: null, signatureDataUrl: DATA_URL })).toContain(
      'alt="signature-clara"',
    );
  });
});

describe("appendSignature", () => {
  it("ajoute le bloc à la suite du corps", () => {
    const block = buildSignatureBlock({ fullName: "A B", title: null, signatureDataUrl: DATA_URL });
    expect(appendSignature("<p>Bonjour</p>", block)).toBe(`<p>Bonjour</p>${block}`);
  });

  it("remplace une signature déjà posée au lieu d'en empiler deux", () => {
    const first = buildSignatureBlock({ fullName: "A B", title: null, signatureDataUrl: DATA_URL });
    const second = buildSignatureBlock({ fullName: "C D", title: null, signatureDataUrl: DATA_URL });
    const signedOnce = appendSignature("<p>Bonjour</p>", first);

    const signedTwice = appendSignature(signedOnce, second);

    expect(signedTwice.match(/signature-clara/g)).toHaveLength(1);
    expect(signedTwice).toContain("C D");
    expect(signedTwice).not.toContain("A B");
  });
});

describe("escapeHtml", () => {
  it("couvre les cinq caractères que l'ancien code échappait", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("échappe l'esperluette en premier, sans double échappement", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});
