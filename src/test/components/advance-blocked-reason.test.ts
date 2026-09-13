import { describe, expect, it } from "vitest";
import { advanceBlockedReason } from "@/components/courier/advance-blocked-reason";

/** Cas nominal bloqué : tout est en place SAUF la transition « Suivante ». */
const SANS_CHAINE_NOMINALE = {
  hasOrganization: true,
  hasWorkflow: true,
  hasState: true,
  isFinalState: false,
  transitionCount: 1,
  stateName: "Nouveau courrier",
};

describe("advanceBlockedReason", () => {
  it("workflow sans transition « Suivante » : ne parle PAS d'organisation", () => {
    // La régression d'origine : le message envoyait affecter une organisation
    // qui était déjà affectée (Seine Normandie Agglomération, 2026-09-13).
    const message = advanceBlockedReason(SANS_CHAINE_NOMINALE);
    expect(message).not.toMatch(/organisation/i);
    expect(message).toContain("« Suivante »");
    expect(message).toContain("« Nouveau courrier »");
    expect(message).toContain("Autres actions");
  });

  it("aucune organisation gestionnaire : c'est le premier geste à faire", () => {
    expect(
      advanceBlockedReason({ ...SANS_CHAINE_NOMINALE, hasOrganization: false }),
    ).toBe("Affectez d'abord une organisation gestionnaire.");
  });

  it("organisation sans workflow entrant : dit que c'est le workflow qui manque", () => {
    const message = advanceBlockedReason({ ...SANS_CHAINE_NOMINALE, hasWorkflow: false });
    expect(message).toContain("workflow de courrier entrant");
  });

  it("courrier sans état : dit comment le replacer au début", () => {
    const message = advanceBlockedReason({
      ...SANS_CHAINE_NOMINALE,
      hasState: false,
      stateName: null,
    });
    expect(message).toContain("aucun état de workflow");
    expect(message).toContain("Réaffectez");
  });

  it("état final : il n'y a rien après, ce n'est pas une panne", () => {
    const message = advanceBlockedReason({
      ...SANS_CHAINE_NOMINALE,
      isFinalState: true,
      transitionCount: 0,
      stateName: "Traité",
    });
    expect(message).toContain("« Traité »");
    expect(message).toContain("état final");
  });

  it("état sans aucune transition sortante", () => {
    const message = advanceBlockedReason({ ...SANS_CHAINE_NOMINALE, transitionCount: 0 });
    expect(message).toContain("Aucune transition ne part de « Nouveau courrier »");
  });

  it("nom d'état pas encore chargé : phrase toujours lisible", () => {
    const message = advanceBlockedReason({ ...SANS_CHAINE_NOMINALE, stateName: null });
    expect(message).toContain("l'état courant");
    expect(message).not.toContain("« »");
  });

  it("l'ordre des causes va de la plus en amont à la plus en aval", () => {
    // Sans organisation, rien d'autre n'a de sens : ce cas prime sur tous.
    const rien = {
      hasOrganization: false,
      hasWorkflow: false,
      hasState: false,
      isFinalState: false,
      transitionCount: 0,
      stateName: null,
    };
    expect(advanceBlockedReason(rien)).toBe("Affectez d'abord une organisation gestionnaire.");
  });
});
