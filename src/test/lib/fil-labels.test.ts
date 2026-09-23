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
});
