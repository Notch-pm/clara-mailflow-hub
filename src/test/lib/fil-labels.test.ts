import { describe, expect, it } from "vitest";
import { describeCourierEvent } from "@/lib/courier-history";
import { describeIrisEvent, interventionStatusLabel } from "@/lib/iris-timeline";

describe("describeIrisEvent", () => {
  it("traduit un changement de statut avec les libellés de Clara", () => {
    expect(describeIrisEvent({ type: "status_changed", detail: { from: "a_traiter", to: "resolue_positive", motif: null } })).toEqual({
      title: "Changement de statut",
      detail: "À traiter → Accordée",
    });
  });

  it("nomme l'origine d'une demande reçue", () => {
    expect(describeIrisEvent({ type: "created", detail: { source: "portail-citoyen" } }).detail).toBe("Portail");
  });

  it("date une intervention demandée", () => {
    const d = describeIrisEvent({ type: "intervention_requested", detail: { intervenant: "Dominique", requested_for: "2026-09-25" } });
    expect(d.title).toBe("Intervention demandée");
    expect(d.detail).toBe(`Dominique · pour le ${new Date("2026-09-25").toLocaleDateString("fr-FR")}`);
  });

  it("un type inconnu s'affiche tel quel, sans détail inventé", () => {
    expect(describeIrisEvent({ type: "nouveau_type", detail: { x: "y" } })).toEqual({ title: "nouveau_type", detail: null });
  });

  it("libellés d'intervention, repli sur le code", () => {
    expect(interventionStatusLabel("realisee")).toBe("Réalisée");
    expect(interventionStatusLabel("autre")).toBe("autre");
  });
});

describe("describeCourierEvent", () => {
  it("reprend les libellés de l'historique du poste de travail", () => {
    expect(describeCourierEvent("state_changed", { from_name: "Reçu", to_name: "En instruction" })).toEqual({
      title: "Changement d'état",
      detail: "Reçu → En instruction",
    });
    expect(describeCourierEvent("reply_sent", null)).toEqual({ title: "Réponse envoyée", detail: null });
  });

  it("payload JSON libre : un non-objet ne donne aucun détail, les pièces se comptent", () => {
    expect(describeCourierEvent("state_changed", "texte")).toEqual({ title: "Changement d'état", detail: null });
    expect(describeCourierEvent("state_changed", [1, 2])).toEqual({ title: "Changement d'état", detail: null });
    expect(describeCourierEvent("reply_email_sent", { to: "a@b.fr", attachments: 2 }).detail).toBe(
      "à a@b.fr · 2 pièces jointes",
    );
    expect(describeCourierEvent("reply_email_sent", { to: "a@b.fr", attachments: "1" }).detail).toBe(
      "à a@b.fr · 1 pièce jointe",
    );
  });

  it("lu sur le courrier reçu, l'événement d'une réponse parle de réponse", () => {
    expect(describeCourierEvent("reply_signed", { reply_id: "r1" }, "p1").title).toBe("Réponse signée");
  });

  it("lu sur un sortant sans parent, il parle du courrier lui-même", () => {
    // Un courrier à l'initiative de la collectivité porte son propre
    // historique : ce n'est la réponse à rien.
    expect(describeCourierEvent("reply_signed", { reply_id: "s1" }, "s1").title).toBe("Courrier signé");
    expect(describeCourierEvent("reply_visa_granted", { reply_id: "s1", state_name: "Visa DGS" }, "s1")).toEqual({
      title: "Courrier visé",
      detail: "Étape « Visa DGS »",
    });
    expect(
      describeCourierEvent("outbound_created", { reply_id: "s1", organization_name: "Cabinet", recipient_name: "Jean Martin" }, "s1"),
    ).toEqual({ title: "Courrier créé", detail: "Par Cabinet à Jean Martin" });
    // Un lien se lit des deux côtés, avec la référence de l'autre courrier.
    expect(
      describeCourierEvent("outbound_linked", { reply_id: "s1", other_chrono: "2026-E-00042", other_subject: "Nuisances" }, "s1"),
    ).toEqual({ title: "Lié à un courrier reçu", detail: "2026-E-00042 « Nuisances »" });
    expect(
      describeCourierEvent("outbound_linked", { reply_id: "s1", other_chrono: "2026-S-00007", other_subject: "Convocation" }, "e1").title,
    ).toBe("Lien avec un courrier sortant");
    // Sans libellé propre, on garde le libellé commun.
    expect(describeCourierEvent("reply_unsigned", { reply_id: "s1" }, "s1").title).toBe("Signature retirée");
  });
});
