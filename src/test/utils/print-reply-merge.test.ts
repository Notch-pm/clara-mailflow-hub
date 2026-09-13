import { describe, expect, it } from "vitest";
import Handlebars from "handlebars";
import {
  SIGNATURE_PRINT_CSS,
  buildContactBlock,
  mergeContext,
  withPrintCss,
  type PrintReplyOptions,
} from "@/utils/printReply";

const BASE: PrintReplyOptions = {
  bodyHtml: "<p>Corps</p>",
  subject: "Re: Votre demande",
  senderName: "Jean Dupont",
  senderFirstName: "Jean",
  senderLastName: "Dupont",
  date: null,
};

function render(template: string, options: Partial<PrintReplyOptions> = {}): string {
  return Handlebars.compile(template)(mergeContext({ ...BASE, ...options }, "3 mai 2026"));
}

describe("buildContactBlock — organisation de Clara (adresse décomposée)", () => {
  it("nom en gras, puis l'adresse ligne à ligne", () => {
    expect(
      buildContactBlock("ACCM", {
        address_street: "10 avenue de Frémeur",
        address_postal_code: "44000",
        address_city: "Nantes",
        phone: "0652790763",
        contact_email: "contact@accm.fr",
      }),
    ).toBe(
      "<strong>ACCM</strong><br>10 avenue de Frémeur<br>44000 Nantes<br>Tél : 0652790763<br>Email : contact@accm.fr",
    );
  });
});

describe("buildContactBlock — référentiel (adresse en texte libre)", () => {
  it("découpe l'adresse d'une seule ligne en bloc postal", () => {
    // Le cas réel : `socle_organizations.address` de Seine Normandie Agglomération.
    expect(
      buildContactBlock("Seine Normandie Agglomération", {
        address: "12 rue de la Mare à Jouy, 27120 Douains",
        phone: "02 32 53 50 03",
      }),
    ).toBe(
      "<strong>Seine Normandie Agglomération</strong><br>12 rue de la Mare à Jouy<br>27120 Douains<br>Tél : 02 32 53 50 03",
    );
  });

  it("reconnaît `email` autant que `contact_email`", () => {
    // La régression d'origine : une ligne du référentiel passée à un bloc qui
    // n'attendait que les noms de colonnes de Clara se réduisait au nom.
    expect(buildContactBlock("Mairie de Vernon", { email: "mairie@vernon27.fr" })).toBe(
      "<strong>Mairie de Vernon</strong><br>Email : mairie@vernon27.fr",
    );
  });

  it("respecte les retours à la ligne déjà présents", () => {
    expect(buildContactBlock(null, { address: "5 rue A\n75001 Paris" })).toBe("5 rue A<br>75001 Paris");
  });
});

describe("buildContactBlock — usager", () => {
  it("nom, organisme, adresse, téléphone, courriel", () => {
    expect(
      buildContactBlock("Jean Dupont", {
        organization: "Boulangerie du Forum",
        address: "12 rue des Lilas, 75011 Paris",
        phone: "0612345678",
        email: "jean@example.fr",
      }),
    ).toBe(
      "<strong>Jean Dupont</strong><br>Boulangerie du Forum<br>12 rue des Lilas<br>75011 Paris<br>Tél : 0612345678<br>Email : jean@example.fr",
    );
  });

  it("n'écrit pas l'organisme quand il répète le nom", () => {
    expect(buildContactBlock("Comité des fêtes", { organization: "Comité des fêtes" })).toBe(
      "<strong>Comité des fêtes</strong>",
    );
  });
});

describe("buildContactBlock — priorités et robustesse", () => {
  it("les colonnes de Clara l'emportent sur le texte libre, jamais les deux", () => {
    const bloc = buildContactBlock("ACCM", {
      address_street: "10 avenue de Frémeur",
      address_city: "Nantes",
      address: "Adresse du référentiel, 13200 Arles",
    });
    expect(bloc).toContain("10 avenue de Frémeur");
    expect(bloc).not.toContain("Arles");
  });

  it("échappe le HTML des coordonnées", () => {
    expect(buildContactBlock("<script>", { address: "a & b" })).toBe(
      "<strong>&lt;script&gt;</strong><br>a &amp; b",
    );
  });

  it("aucune coordonnée : le nom seul, sans <br> orphelin", () => {
    expect(buildContactBlock("ACCM", null)).toBe("<strong>ACCM</strong>");
    expect(buildContactBlock("ACCM", { address: "   " })).toBe("<strong>ACCM</strong>");
  });
});

describe("mergeContext — variables du modèle", () => {
  it("sert les nouvelles variables usager", () => {
    expect(render("{{usager}} / {{usager_prenom}} / {{usager_nom}}")).toBe("Jean Dupont / Jean / Dupont");
  });

  it("sert encore {{expediteur}} : les modèles enregistrés en contiennent", () => {
    // Le retirer n'aurait pas levé d'erreur — il aurait imprimé un blanc.
    expect(render("{{expediteur}}")).toBe("Jean Dupont");
    expect(render("{{expediteur}}")).toBe(render("{{usager}}"));
  });

  it("les blocs avec adresse ne sont pas échappés", () => {
    const html = render("{{{usager_complete}}}|{{{organisation_complete}}}", {
      senderCompleteHtml: "<strong>Jean</strong><br>Paris",
      organizationCompleteHtml: "<strong>ACCM</strong><br>Arles",
    });
    expect(html).toBe("<strong>Jean</strong><br>Paris|<strong>ACCM</strong><br>Arles");
  });

  it("une variable sans valeur rend une chaîne vide, pas « undefined »", () => {
    const html = render("[{{usager_prenom}}][{{{usager_complete}}}][{{service}}]", {
      senderFirstName: null,
      senderCompleteHtml: null,
      serviceName: null,
    });
    expect(html).toBe("[][][]");
  });
});

describe("signature à l'impression", () => {
  it("la contrainte est en !important — sinon le style en ligne de l'image gagne", () => {
    // `buildSignedBody` pose style="max-width:200px;max-height:80px" sur l'image :
    // une règle de feuille de style sans !important ne s'applique jamais.
    expect(SIGNATURE_PRINT_CSS).toMatch(/max-width:\s*45mm\s*!important/);
    expect(SIGNATURE_PRINT_CSS).toMatch(/max-height:\s*18mm\s*!important/);
  });

  it("le sélecteur n'est pas limité au corps de lettre", () => {
    // Dans un modèle d'organisation, {{signature}} peut atterrir n'importe où.
    expect(SIGNATURE_PRINT_CSS).toContain('img[alt="signature-clara"]');
    expect(SIGNATURE_PRINT_CSS).not.toContain(".letter-body");
  });

  it("s'insère avant </head> du modèle", () => {
    const out = withPrintCss("<html><head><title>x</title></head><body>b</body></html>", SIGNATURE_PRINT_CSS);
    expect(out.indexOf("<style>")).toBeGreaterThan(out.indexOf("<title>"));
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("<body>b</body>");
  });

  it("se place en tête quand le modèle n'a pas de <head>", () => {
    const out = withPrintCss("<div>maquette</div>", SIGNATURE_PRINT_CSS);
    expect(out.startsWith("<style>")).toBe(true);
    expect(out).toContain("<div>maquette</div>");
  });
});
