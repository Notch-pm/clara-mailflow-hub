import { describe, expect, it } from "vitest";
import {
  contactFormSchema,
  contactToFormValues,
  formValuesToPayload,
  rolesToSend,
  sortRoleOptions,
  toggleRoleId,
} from "@/lib/contact-form";
import {
  buildContactFilters,
  CONTACTS_PAGE_SIZE,
  describeActiveFilters,
  paginateContacts,
  pageSummary,
  type ContactListState,
} from "@/lib/contact-list";
import { relationsToInputs, relationsWithout } from "@/lib/contact-relations";
import { channelLabel, civilityLabel, contactAddress, phoneOrDash } from "@/lib/contact-labels";
import type { SocleContact } from "@/services/socleContactService";

const base: ContactListState = { search: "", typeFilter: "all", statusFilter: "active", categoryFilter: [] };

describe("formulaire contact", () => {
  it("exige civilité et nom pour une personne, raison sociale sinon", () => {
    const p = contactFormSchema.safeParse({ contact_type: "personne" });
    expect(p.success).toBe(false);
    const paths = !p.success ? p.error.issues.map((i) => i.path[0]) : [];
    expect(paths).toEqual(expect.arrayContaining(["civility", "last_name"]));
    expect(contactFormSchema.safeParse({ contact_type: "entreprise" }).success).toBe(false);
    expect(contactFormSchema.safeParse({ contact_type: "entreprise", legal_name: "ACME" }).success).toBe(true);
  });

  it("refuse un SIRET qui n'a pas 14 chiffres, accepte les espaces", () => {
    const ok = { contact_type: "entreprise", legal_name: "A", siret: "123 456 789 01234" };
    expect(contactFormSchema.safeParse(ok).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...ok, siret: "123" }).success).toBe(false);
  });

  it("valeurs par défaut : personne, champs vides", () => {
    const v = contactToFormValues(null);
    expect(v.contact_type).toBe("personne");
    expect(v.civility).toBeNull();
    expect(v.email).toBe("");
  });

  it("charge utile : champs de l'autre type vidés, chaînes vides en null, SIRET sans espace", () => {
    const org = formValuesToPayload({
      ...contactToFormValues(null),
      contact_type: "entreprise",
      legal_name: " ACME ",
      siret: "123 456 789 01234",
      last_name: "Dupont",
      civility: "monsieur",
    });
    expect(org.legal_name).toBe("ACME");
    expect(org.siret).toBe("12345678901234");
    expect(org.last_name).toBeNull();
    expect(org.civility).toBeNull();
    expect(org.email).toBeNull();

    const person = formValuesToPayload({
      ...contactToFormValues(null),
      civility: "madame",
      last_name: "Martin",
      legal_name: "ignoré",
    });
    expect(person.legal_name).toBeNull();
    expect(person.last_name).toBe("Martin");
  });
});

describe("rôles du formulaire", () => {
  it("Interne puis Élu en tête, le reste par nom", () => {
    const sorted = sortRoleOptions([
      { id: "1", name: "Usager" },
      { id: "2", name: "Conseil", code: "elu" },
      { id: "3", name: "Agents", code: "interne" },
      { id: "4", name: "Bailleur" },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["3", "2", "4", "1"]);
  });

  it("toggleRoleId ajoute sans doublon et retire", () => {
    expect(toggleRoleId(["a"], "a", true)).toEqual(["a"]);
    expect(toggleRoleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleRoleId(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("n'envoie les rôles que touchés, modifiés et le catalogue chargé", () => {
    expect(rolesToSend(null, ["a"], true)).toBeNull();
    expect(rolesToSend(["a"], ["a"], true)).toBeNull();
    expect(rolesToSend(["b"], ["a"], false)).toBeNull();
    expect(rolesToSend(["b"], ["a"], true)).toEqual(["b"]);
    expect(rolesToSend([], ["a"], true)).toEqual([]);
  });
});

describe("relations", () => {
  const relations = [
    { id: "r1", contact: { id: "c1" }, role: { id: "x" } },
    { id: "r2", contact: { id: "c2" }, role: { id: "y" } },
  ] as unknown as SocleContact["relations"];

  it("convertit et retire une relation", () => {
    expect(relationsToInputs(relations)).toEqual([
      { related_contact_id: "c1", role_id: "x" },
      { related_contact_id: "c2", role_id: "y" },
    ]);
    expect(relationsWithout(relations, "r1")).toEqual([{ related_contact_id: "c2", role_id: "y" }]);
    expect(relationsToInputs(undefined)).toEqual([]);
  });
});

describe("liste des contacts", () => {
  it("filtres : « all » et vide deviennent undefined", () => {
    expect(buildContactFilters(base, "")).toEqual({ search: undefined, type: undefined, status: "active", roles: undefined });
    expect(
      buildContactFilters({ ...base, typeFilter: "entreprise", statusFilter: "all", categoryFilter: ["elu"] }, "dup"),
    ).toEqual({ search: "dup", type: "entreprise", status: undefined, roles: ["elu"] });
  });

  it("pagination à l'aveugle : page pleine exacte = pas de page suivante", () => {
    const full = Array.from({ length: CONTACTS_PAGE_SIZE }, (_, i) => i);
    expect(paginateContacts(full).hasNextPage).toBe(false);
    const more = [...full, 999];
    const p = paginateContacts(more);
    expect(p.hasNextPage).toBe(true);
    expect(p.rows).toHaveLength(CONTACTS_PAGE_SIZE);
    expect(paginateContacts(undefined)).toEqual({ rows: [], hasNextPage: false });
  });

  it("pastilles : aucune par défaut, une par filtre actif", () => {
    expect(describeActiveFilters(base)).toEqual([]);
    const keys = describeActiveFilters({
      search: " x ",
      typeFilter: "association",
      statusFilter: "archived",
      categoryFilter: ["interne"],
    });
    expect(keys.map((c) => c.key)).toEqual(["search", "type", "category", "status"]);
    expect(keys[0].label).toBe("Recherche : « x »");
    expect(describeActiveFilters({ ...base, statusFilter: "all" })[0].label).toBe("Archivés inclus");
  });

  it("résumé de page", () => {
    expect(pageSummary(0, 5, true)).toBe("Chargement…");
    expect(pageSummary(2, 0, false)).toBe("Page 3");
    expect(pageSummary(1, 3, false)).toContain("page 2");
  });
});

describe("libellés", () => {
  it("téléphone : mobile, fixe, tiret", () => {
    expect(phoneOrDash({ mobile_phone: "06", landline_phone: "01" })).toBe("06");
    expect(phoneOrDash({ mobile_phone: null, landline_phone: "01" })).toBe("01");
    expect(phoneOrDash({ mobile_phone: null, landline_phone: null })).toBe("—");
  });
  it("civilité, canal, adresse", () => {
    expect(civilityLabel("madame")).toBe("Madame");
    expect(civilityLabel("x")).toBeNull();
    expect(channelLabel("telephone")).toBe("Téléphone");
    expect(contactAddress({ address_line1: "1 rue A", address_line2: null })).toBe("1 rue A");
    expect(contactAddress({ address_line1: "1 rue A", address_line2: "Bât B" })).toBe("1 rue A, Bât B");
  });
});
