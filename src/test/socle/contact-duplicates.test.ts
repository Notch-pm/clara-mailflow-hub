import { describe, it, expect } from "vitest";
import {
  buildMatchPayload,
  hasDuplicateSignal,
  normalizeEmail,
  type ContactDraft,
} from "@/lib/contact-duplicates";

/**
 * Le rapprochement lui-même appartient au Socle (`POST /v1/contacts/match`) et
 * est testé chez lui. Ici : la description de la saisie envoyée au référentiel,
 * dont le contrat est strict (whitelist des clés, au moins un critère).
 */

describe("buildMatchPayload — description de la saisie", () => {
  it("n'émet que les critères renseignés", () => {
    expect(buildMatchPayload({ last_name: "Dupont", first_name: "Jean" })).toEqual({
      last_name: "Dupont",
      first_name: "Jean",
    });
  });

  it("met l'email en minuscules et le débarrasse des espaces", () => {
    const payload = buildMatchPayload({ email: "  Jean.Dupont@Example.FR " });
    expect(payload.email).toBe("jean.dupont@example.fr");
  });

  it("ignore un email encore incomplet à la saisie", () => {
    expect(buildMatchPayload({ last_name: "Dupont", email: "jean.dupont" })).not.toHaveProperty(
      "email",
    );
  });

  it("réduit le SIRET à ses chiffres, le Socle comparant sur les chiffres seuls", () => {
    expect(buildMatchPayload({ siret: "123 456 789 00012" }).siret).toBe("12345678900012");
  });

  it("regroupe les téléphones de la saisie en un seul tableau", () => {
    const payload = buildMatchPayload({
      mobile_phone: "06 12 34 56 78",
      landline_phone: "01 23 45 67 89",
    });
    expect(payload.phones).toEqual(["06 12 34 56 78", "01 23 45 67 89"]);
  });

  it("transmet les numéros au format brut — le Socle les normalise lui-même", () => {
    expect(buildMatchPayload({ phone: "+33 6 12 34 56 78" }).phones).toEqual(["+33 6 12 34 56 78"]);
  });

  it("dédoublonne deux champs portant le même numéro", () => {
    const payload = buildMatchPayload({ phone: "0612345678", mobile_phone: "0612345678" });
    expect(payload.phones).toEqual(["0612345678"]);
  });

  it("ignore une saisie trop courte pour être un numéro", () => {
    expect(buildMatchPayload({ last_name: "Dupont", phone: "06" })).not.toHaveProperty("phones");
  });

  it("restreint au type de contact quand le formulaire le connaît", () => {
    const payload = buildMatchPayload({ contact_type: "entreprise", legal_name: "Boulangerie" });
    expect(payload.contact_type).toBe("entreprise");
  });

  it("ne restreint pas le type pour un participant, dont la nature est inconnue", () => {
    expect(buildMatchPayload({ last_name: "Dupont" })).not.toHaveProperty("contact_type");
  });

  it("transmet les fiches à écarter et la borne de résultats", () => {
    const payload = buildMatchPayload({ last_name: "Dupont" }, { excludeIds: ["c1"], limit: 3 });
    expect(payload).toMatchObject({ exclude_ids: ["c1"], limit: 3 });
  });

  it("borne la limite au maximum accepté par le Socle", () => {
    expect(buildMatchPayload({ last_name: "Dupont" }, { limit: 99 }).limit).toBe(20);
  });

  it("n'émet aucune clé inconnue du contrat, qui vaudrait un 400", () => {
    const draft: ContactDraft = {
      contact_type: "personne",
      first_name: "Jean",
      last_name: "Dupont",
      usage_name: "Martin",
      legal_name: null,
      siret: null,
      birth_date: "1980-05-12",
      email: "jean@example.fr",
      phone: "0612345678",
      mobile_phone: null,
      landline_phone: null,
    };
    const allowed = [
      "contact_type",
      "first_name",
      "last_name",
      "usage_name",
      "legal_name",
      "siret",
      "birth_date",
      "email",
      "phones",
      "status",
      "exclude_ids",
      "limit",
    ];
    const payload = buildMatchPayload(draft, { excludeIds: ["c1"], limit: 5 });
    expect(Object.keys(payload).filter((k) => !allowed.includes(k))).toEqual([]);
  });
});

describe("hasDuplicateSignal", () => {
  it("est vrai dès qu'un nom exploitable est saisi", () => {
    expect(hasDuplicateSignal({ last_name: "Dupont" })).toBe(true);
  });

  it("est vrai sur un email seul", () => {
    expect(hasDuplicateSignal({ email: "jean@example.fr" })).toBe(true);
  });

  it("est vrai sur un téléphone seul — angle mort levé par le Socle", () => {
    expect(hasDuplicateSignal({ phone: "06 12 34 56 78" })).toBe(true);
  });

  it("est vrai sur une raison sociale seule", () => {
    expect(hasDuplicateSignal({ legal_name: "Boulangerie du Forum" })).toBe(true);
  });

  it("est faux sur un prénom seul, qui ne rapproche rien", () => {
    expect(hasDuplicateSignal({ first_name: "Jean" })).toBe(false);
  });

  it("est faux tant que la saisie ne porte rien d'interrogeable", () => {
    expect(hasDuplicateSignal({})).toBe(false);
    expect(hasDuplicateSignal({ last_name: "D" })).toBe(false);
    expect(hasDuplicateSignal({ email: "jean" })).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("met en minuscules et retire les espaces", () => {
    expect(normalizeEmail("  Jean.Dupont@Example.FR ")).toBe("jean.dupont@example.fr");
  });
});
