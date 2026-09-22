import { describe, expect, it } from "vitest";
import { consentsSummary, consentViews, parseSocleConsents } from "@/lib/consents";
import type { SocleConsent, SocleContact } from "@/services/socleContactService";

const base = { id: "c-1", contact_type: "personne" } as unknown as SocleContact;

describe("consentViews — état des consentements RGPD d'une fiche", () => {
  it("distingue « jamais demandé » d'un refus : c'est la date qui tranche", () => {
    const jamais = consentViews(base);
    expect(jamais.map((v) => v.kind)).toEqual(["traitement", "partage"]);
    expect(jamais[0]).toMatchObject({ granted: false, at: null, neverCollected: true });

    const refuse = consentViews({
      ...base, consent_partage: false, consent_partage_at: "2026-09-20T08:00:00Z",
    } as SocleContact);
    expect(refuse[1]).toMatchObject({ granted: false, neverCollected: false });
  });

  it("montre la phrase du DERNIER recueil, pas celle d'aujourd'hui", () => {
    const views = consentViews({
      ...base,
      consent_partage: true,
      consent_partage_at: "2026-09-20T08:00:00Z",
      consents: [{
        kind: "partage", granted: true, statement: "…aux services de l'ancien nom…",
        source_app: "iris", source_reference: null, collected_at: "2026-09-20T08:00:00Z",
      }],
    } as SocleContact, "Nouveau nom");
    expect(views[1].statement).toBe("…aux services de l'ancien nom…");
    // Sans historique chargé (liste, rapprochement), le catalogue prend le relais.
    expect(consentViews(base, "ACCM")[1].statement).toContain("aux services de ACCM");
  });

  it("marque l'obligatoire comme tel", () => {
    const views = consentViews(base);
    expect(views[0].required).toBe(true);
    expect(views[1].required).toBe(false);
  });
});

describe("parseSocleConsents — historique", () => {
  it("trie du plus récent au plus ancien et ignore un type hors catalogue", () => {
    const rows = parseSocleConsents([
      { kind: "traitement", granted: true, statement: "A", source_app: "clara", source_reference: "courrier-1", collected_at: "2026-09-01T00:00:00Z" },
      { kind: "newsletter", granted: true, statement: "PIÈGE", source_app: "x", source_reference: null, collected_at: "2026-09-30T00:00:00Z" },
      { kind: "partage", granted: false, statement: "B", source_app: "iris", source_reference: null, collected_at: "2026-09-20T00:00:00Z" },
    ] as SocleConsent[]);
    expect(rows.map((r) => r.statement)).toEqual(["B", "A"]);
    expect(rows[0]).toMatchObject({ label: "Partage aux services", granted: false, source: "iris", reference: null });
    expect(rows[1].reference).toBe("courrier-1");
  });

  it("ne tombe pas sur un historique absent ou vide", () => {
    expect(parseSocleConsents(undefined)).toEqual([]);
    expect(parseSocleConsents(null)).toEqual([]);
    expect(parseSocleConsents([])).toEqual([]);
  });
});

describe("consentsSummary", () => {
  it("dit l'absence plutôt que de laisser croire à un refus", () => {
    expect(consentsSummary(consentViews(base))).toBe("Aucun consentement recueilli à ce jour");
    expect(consentsSummary(consentViews({
      ...base,
      consent_traitement: true, consent_traitement_at: "2026-09-20T08:00:00Z",
      consent_partage: false, consent_partage_at: "2026-09-20T08:00:00Z",
    } as SocleContact))).toBe("Traitement de la demande : accordé · Partage aux services : refusé");
  });
});
