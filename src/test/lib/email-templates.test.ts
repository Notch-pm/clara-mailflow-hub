import { describe, expect, it } from "vitest";
import {
  applyEmailTemplate,
  emailTemplateValues,
  missingVariables,
  organizationNamesFor,
  plainTextToHtml,
  proposedTemplates,
  renderTemplateText,
} from "@/lib/email-templates";

describe("renderTemplateText (moteur partagé avec Iris)", () => {
  it("remplace les variables et vide celles sans valeur", () => {
    expect(renderTemplateText("Bonjour {{ usager.nom }} {{agent.nom}}", { "usager.nom": "Durand" })).toBe(
      "Bonjour Durand ",
    );
  });

  it("sections conditionnelles positives et négatives", () => {
    const text =
      "A{{#demande.reference}} réf. {{demande.reference}}{{/demande.reference}}{{^demande.reference}} sans réf.{{/demande.reference}}";
    expect(renderTemplateText(text, { "demande.reference": "2026-0042" })).toBe("A réf. 2026-0042");
    expect(renderTemplateText(text, {})).toBe("A sans réf.");
  });

  it("un jeton de section orphelin disparaît", () => {
    expect(renderTemplateText("x{{#a.b}}y", {})).toBe("xy");
  });
});

describe("plainTextToHtml", () => {
  it("paragraphes, sauts de ligne et échappement", () => {
    expect(plainTextToHtml("Madame,\n\nLigne 1\nLigne <2>\n\n\n")).toBe(
      "<p>Madame,</p><p>Ligne 1<br>Ligne &lt;2&gt;</p>",
    );
  });
});

describe("applyEmailTemplate", () => {
  const template = {
    subject: "Votre courrier {{demande.reference}}  du {{demande.date_depot}}",
    body: "{{usager.salutation}},\n\n{{#demande.objet}}Objet : {{demande.objet}}\n\n{{/demande.objet}}Cordialement,\n{{agent.nom}}",
  };

  it("objet sur une ligne, corps en HTML, variables manquantes listées", () => {
    const values = emailTemplateValues({
      recipient: { first_name: "Marie", last_name: "Durand" },
      dossier: { reference: "2026-0042", receivedAt: "2026-08-21T09:00:00Z" },
      serviceName: "Voirie",
      agentName: null,
      organizationName: "Ville",
    });
    const out = applyEmailTemplate(template, values);
    expect(out.subject).toBe("Votre courrier 2026-0042 du 21 août 2026");
    expect(out.bodyHtml).toBe("<p>Madame, Monsieur,</p><p>Cordialement,</p>");
    expect(out.missing).toEqual(["agent.nom"]);
  });

  it("une valeur ne peut pas injecter de HTML", () => {
    const out = applyEmailTemplate({ subject: "x", body: "{{usager.nom}}" }, { "usager.nom": "<img src=x>" });
    expect(out.bodyHtml).toBe("<p>&lt;img src=x&gt;</p>");
  });
});

describe("missingVariables", () => {
  it("ignore les variables des sections écartées, dédoublonne", () => {
    expect(
      missingVariables({ subject: "{{a.b}}", body: "{{#c.d}}{{x.y}}{{/c.d}} {{a.b}} {{e.f}}" }, { "e.f": "ok" }),
    ).toEqual(["a.b"]);
  });
});

describe("emailTemplateValues", () => {
  it("personne morale : nom complet = raison sociale ; valeurs vides omises", () => {
    const values = emailTemplateValues({
      recipient: { organization: "Boulangerie Durand", email: " ", phone: "06 00 00 00 00" },
      dossier: { channel: "email", subject: "Terrasse" },
      serviceName: null,
      agentName: "Camille Martin",
      organizationName: "Ville",
    });
    expect(values).toEqual({
      "usager.salutation": "Madame, Monsieur",
      "usager.nom_complet": "Boulangerie Durand",
      "usager.raison_sociale": "Boulangerie Durand",
      "usager.telephone": "06 00 00 00 00",
      "demande.objet": "Terrasse",
      "demande.canal": "Courriel",
      "agent.nom": "Camille Martin",
      "organisation.nom": "Ville",
    });
  });

  it("nom saisi d'un bloc (sans prénom) : sert de nom et de nom complet", () => {
    const values = emailTemplateValues({ recipient: { name: "M. Dupont" }, dossier: null });
    expect(values["usager.nom"]).toBe("M. Dupont");
    expect(values["usager.nom_complet"]).toBe("M. Dupont");
  });
});

describe("activation par organisme (réglée dans le Socle)", () => {
  const templates = [
    { id: "1", socle_organization_ids: ["root", "voirie"] },
    { id: "2", socle_organization_ids: ["root"] },
    { id: "3", socle_organization_ids: [] },
  ];

  it("égalité stricte : cocher la racine n'ouvre pas ses services", () => {
    expect(proposedTemplates(templates, "voirie").map((t) => t.id)).toEqual(["1"]);
    expect(proposedTemplates(templates, "root").map((t) => t.id)).toEqual(["1", "2"]);
    expect(proposedTemplates(templates, null)).toEqual([]);
  });

  it("noms des organisations du tenant, obsolètes et inconnues ignorées", () => {
    const orgs = [
      { socle_id: "voirie", name: "Voirie" },
      { socle_id: "root", name: "Agglo" },
      { socle_id: "old", name: "Ancien", obsoleted_at: "2026-01-01" },
    ];
    expect(organizationNamesFor({ socle_organization_ids: ["voirie", "root", "old", "x"] }, orgs)).toEqual([
      "Agglo",
      "Voirie",
    ]);
  });
});
