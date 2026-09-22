import { describe, expect, it } from "vitest";
import {
  CONSENTS,
  consentDef,
  consentsSatisfied,
  consentStatement,
  DEFAULT_ORGANISM,
  defaultConsentAnswers,
  normalizeConsents,
  organismLabel,
  parseConsentRecords,
} from "../../../supabase/functions/_shared/consents/catalog";

// Le projet compile en `strict: false`, où le rétrécissement par discriminant
// n'opère pas : on lit le message à plat, sans affaiblir le type du module.
const messageOf = (r: unknown) => (r as { message?: string }).message ?? "";

describe("catalogue des consentements", () => {
  it("compte exactement deux consentements, l'obligatoire en premier", () => {
    expect(CONSENTS.map((c) => c.kind)).toEqual(["traitement", "partage"]);
    expect(CONSENTS[0].required).toBe(true);
    expect(CONSENTS[1].required).toBe(false);
  });

  it("ouvre le formulaire avec le facultatif coché et l'obligatoire décoché", () => {
    expect(defaultConsentAnswers()).toEqual({ traitement: false, partage: true });
  });

  it("ne connaît aucun autre type", () => {
    expect(consentDef("newsletter")).toBeNull();
    expect(consentDef("traitement")?.required).toBe(true);
  });
});

describe("consentStatement", () => {
  it("interpole le nom de l'organisation dans le partage", () => {
    expect(consentStatement("partage", "la Ville d'Arles")).toBe(
      "J'accepte de partager ces informations aux services de la Ville d'Arles afin d'améliorer "
      + "le traitement de ma demande et de mes futures demandes.",
    );
  });

  it("se replie sur un nom générique plutôt que de laisser un trou", () => {
    for (const name of [null, undefined, "", "   "]) {
      expect(consentStatement("partage", name)).toContain(`aux services de ${DEFAULT_ORGANISM} afin`);
    }
    expect(organismLabel("  ACCM  ")).toBe("ACCM");
  });

  it("ne dépend pas de l'organisme pour le traitement", () => {
    expect(consentStatement("traitement", "Arles")).toBe(consentStatement("traitement", null));
    expect(consentStatement("traitement")).toContain("dans le cadre du traitement de ma demande");
  });
});

describe("normalizeConsents — garde du dépôt portail", () => {
  const ok = [{ kind: "traitement", granted: true }, { kind: "partage", granted: true }];

  it("compose le libellé côté serveur et rend le catalogue complet", () => {
    const res = normalizeConsents(ok, "ACCM");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.consents).toEqual([
      { kind: "traitement", granted: true, statement: consentStatement("traitement") },
      { kind: "partage", granted: true, statement: consentStatement("partage", "ACCM") },
    ]);
  });

  it("refuse le dépôt sans le consentement obligatoire", () => {
    for (const raw of [
      [{ kind: "traitement", granted: false }, { kind: "partage", granted: true }],
      [{ kind: "partage", granted: true }],
      [],
    ]) {
      const res = normalizeConsents(raw, "ACCM");
      expect(res.ok).toBe(false);
      expect(messageOf(res)).toContain("obligatoire");
    }
  });

  it("accepte le refus du facultatif, et son absence vaut refus", () => {
    const explicite = normalizeConsents(
      [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }], "ACCM");
    const absent = normalizeConsents([{ kind: "traitement", granted: true }], "ACCM");
    expect(explicite.ok && explicite.consents[1].granted).toBe(false);
    expect(absent.ok && absent.consents[1].granted).toBe(false);
    // Le catalogue reste complet : un refus se consigne, il ne disparaît pas.
    expect(absent.ok && absent.consents).toHaveLength(2);
  });

  it("refuse un libellé venu du navigateur", () => {
    const res = normalizeConsents(
      [{ kind: "traitement", granted: true, statement: "je signe ce que je veux" }], "ACCM");
    expect(res.ok).toBe(false);
    expect(messageOf(res)).toContain("composé par le serveur");
  });

  it("refuse une forme invalide, un type hors catalogue et un doublon", () => {
    expect(normalizeConsents(undefined, "A").ok).toBe(false);
    expect(normalizeConsents("oui", "A").ok).toBe(false);
    expect(normalizeConsents([null], "A").ok).toBe(false);
    expect(normalizeConsents([{ kind: "newsletter", granted: true }], "A").ok).toBe(false);
    expect(normalizeConsents([{ kind: "traitement", granted: "oui" }], "A").ok).toBe(false);
    expect(normalizeConsents(
      [{ kind: "traitement", granted: true }, { kind: "traitement", granted: true }], "A").ok).toBe(false);
  });
});

describe("consentsSatisfied — reflet d'écran", () => {
  it("suit la seule exigence du catalogue", () => {
    expect(consentsSatisfied({ traitement: true, partage: false })).toBe(true);
    expect(consentsSatisfied({ traitement: false, partage: true })).toBe(false);
    expect(consentsSatisfied({})).toBe(false);
  });
});

describe("parseConsentRecords — relecture tolérante d'une trace de courrier", () => {
  it("rend le catalogue dans son ordre, quelle que soit celle de la donnée", () => {
    const rows = parseConsentRecords([
      { kind: "partage", granted: false, statement: "Phrase du jour du dépôt." },
      { kind: "traitement", granted: true, statement: "Autre phrase." },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["traitement", "partage"]);
    expect(rows[1].statement).toBe("Phrase du jour du dépôt.");
  });

  it("conserve la date du recueil quand elle est lisible, et l'ignore sinon", () => {
    const rows = parseConsentRecords([
      { kind: "traitement", granted: true, statement: "A", collected_at: "2026-09-22T08:00:00.000Z" },
      { kind: "partage", granted: true, statement: "B", collected_at: "hier" },
    ]);
    expect(rows[0].collected_at).toBe("2026-09-22T08:00:00.000Z");
    expect(rows[1]).not.toHaveProperty("collected_at");
  });

  it("ne tombe jamais sur une trace absente, tronquée ou étrangère", () => {
    expect(parseConsentRecords(null)).toEqual([]);
    expect(parseConsentRecords([])).toEqual([]);
    expect(parseConsentRecords([{ kind: "newsletter", granted: true }])).toEqual([]);
    const sansLibelle = parseConsentRecords([{ kind: "traitement", granted: true }]);
    expect(sansLibelle[0].statement).toBe(consentStatement("traitement"));
  });
});
