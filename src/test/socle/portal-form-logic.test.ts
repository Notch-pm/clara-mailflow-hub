import { describe, expect, it } from "vitest";
import {
  portalConsentAnswersFromForm,
  portalConsentField,
  portalConsentsConfig,
} from "../../../supabase/functions/portal-form/logic";
import { consentStatement, normalizeConsents } from "../../../supabase/functions/_shared/consents/catalog";

describe("portalConsentsConfig — ce que le GET sert au navigateur", () => {
  it("rend les deux consentements dans l'ordre du catalogue, avec la phrase composée", () => {
    const cfg = portalConsentsConfig("Mairie de Rosny-sous-Bois");
    expect(cfg.map((c) => c.kind)).toEqual(["traitement", "partage"]);
    expect(cfg[0]).toMatchObject({ required: true, default_granted: false });
    expect(cfg[1]).toMatchObject({ required: false, default_granted: true });
    expect(cfg[1].statement).toContain("aux services de Mairie de Rosny-sous-Bois");
    expect(cfg[0].statement).toBe(consentStatement("traitement"));
  });

  it("se replie sur « la collectivité » sans nom", () => {
    expect(portalConsentsConfig(null)[1].statement).toContain("aux services de la collectivité");
  });
});

describe("portalConsentAnswersFromForm — lecture du multipart", () => {
  const form = (fields: Record<string, string>) => (k: string) => fields[k] ?? null;

  it("nomme les champs consent_<kind>", () => {
    expect(portalConsentField("traitement")).toBe("consent_traitement");
    expect(portalConsentField("partage")).toBe("consent_partage");
  });

  it("« true » vaut accord, tout le reste vaut refus, l'absent n'est pas transmis", () => {
    expect(portalConsentAnswersFromForm(form({ consent_traitement: "true", consent_partage: "false" })))
      .toEqual([{ kind: "traitement", granted: true }, { kind: "partage", granted: false }]);
    expect(portalConsentAnswersFromForm(form({ consent_traitement: " TRUE ", consent_partage: "oui" })))
      .toEqual([{ kind: "traitement", granted: true }, { kind: "partage", granted: false }]);
    expect(portalConsentAnswersFromForm(form({ consent_partage: "true" })))
      .toEqual([{ kind: "partage", granted: true }]);
    expect(portalConsentAnswersFromForm(form({}))).toEqual([]);
  });

  it("enchaîne avec la garde du dépôt : sans le traitement, 400 ; avec, catalogue complet", () => {
    const sans = normalizeConsents(portalConsentAnswersFromForm(form({ consent_partage: "true" })), "A");
    expect(sans.ok).toBe(false);
    const avec = normalizeConsents(portalConsentAnswersFromForm(form({ consent_traitement: "true" })), "A");
    expect(avec.ok && avec.consents).toEqual([
      { kind: "traitement", granted: true, statement: consentStatement("traitement") },
      { kind: "partage", granted: false, statement: consentStatement("partage", "A") },
    ]);
  });

  it("la phrase servie au GET est celle que le POST consigne", () => {
    const shown = portalConsentsConfig("ACCM");
    const stored = normalizeConsents(
      portalConsentAnswersFromForm(form({ consent_traitement: "true", consent_partage: "true" })), "ACCM");
    expect(stored.ok && stored.consents.map((c) => c.statement)).toEqual(shown.map((c) => c.statement));
  });
});
