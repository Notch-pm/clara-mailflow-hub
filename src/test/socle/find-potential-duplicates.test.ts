import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { findPotentialDuplicates } = await import("@/services/socleContactService");
type SocleContact = Awaited<ReturnType<typeof import("@/services/socleContactService").getContact>>;

const ORG_ID = "org-1";

function contact(overrides: Partial<SocleContact> = {}): SocleContact {
  return {
    id: "c1",
    organization_id: ORG_ID,
    contact_type: "personne",
    civility: "monsieur",
    first_name: "Jean",
    last_name: "Dupont",
    usage_name: null,
    birth_date: null,
    legal_name: null,
    siret: null,
    display_name: "Dupont Jean",
    email: null,
    mobile_phone: null,
    landline_phone: null,
    address_line1: null,
    address_line2: null,
    postal_code: null,
    city: null,
    country: "FR",
    preferred_channel: null,
    consent_email: false,
    consent_sms: false,
    internal_notes: null,
    status: "active",
    roles: [],
    external_references: [],
    relations: [],
    reverse_relations: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  } as SocleContact;
}

/** Filtres de chaque appel `list` passé au proxy socle-contacts. */
function listFilters(): Record<string, unknown>[] {
  return mockSupabase.functions.invoke.mock.calls
    .map(([, opts]) => (opts as { body: Record<string, unknown> }).body)
    .filter((body) => body.action === "list")
    .map((body) => body.filters as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findPotentialDuplicates — interrogation du référentiel", () => {
  it("n'interroge pas le Socle tant que la saisie ne porte rien d'exploitable", async () => {
    const result = await findPotentialDuplicates(ORG_ID, { last_name: "D" });

    expect(result).toEqual([]);
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("n'interroge pas le Socle sans organisation active", async () => {
    await findPotentialDuplicates("", { last_name: "Dupont" });

    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("cherche l'email exact et les fragments de nom, sur les fiches actives", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [], error: null });

    await findPotentialDuplicates(ORG_ID, {
      first_name: "Jean",
      last_name: "Dupont",
      email: "jean.dupont@example.fr",
    });

    const filters = listFilters();
    expect(filters).toContainEqual(
      expect.objectContaining({ email: "jean.dupont@example.fr", status: "active" }),
    );
    expect(filters).toContainEqual(expect.objectContaining({ search: "Dupo", status: "active" }));
    expect(filters).toContainEqual(expect.objectContaining({ search: "Jean", status: "active" }));
  });

  it("restreint au type de contact quand le formulaire le connaît", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [], error: null });

    await findPotentialDuplicates(ORG_ID, { contact_type: "entreprise", legal_name: "Boulangerie du Forum" });

    for (const f of listFilters()) expect(f).toMatchObject({ type: "entreprise" });
  });

  it("ne restreint pas le type pour un participant, dont la nature est inconnue", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [], error: null });

    await findPotentialDuplicates(ORG_ID, { first_name: "Jean", last_name: "Dupont" });

    for (const f of listFilters()) expect(f).not.toHaveProperty("type");
  });
});

describe("findPotentialDuplicates — résultats", () => {
  it("dédoublonne une fiche remontée par plusieurs requêtes", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [contact()], error: null });

    const result = await findPotentialDuplicates(ORG_ID, { first_name: "Jean", last_name: "Dupont" });

    expect(mockSupabase.functions.invoke.mock.calls.length).toBeGreaterThan(1);
    expect(result).toHaveLength(1);
    expect(result[0].contact.id).toBe("c1");
  });

  it("écarte les fiches déjà liées", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [contact()], error: null });

    const result = await findPotentialDuplicates(
      ORG_ID,
      { first_name: "Jean", last_name: "Dupont" },
      { excludeIds: ["c1"] },
    );

    expect(result).toEqual([]);
  });

  it("écarte les fiches ramenées par la recherche mais sans motif de doublon", async () => {
    // « Dupo » ramène aussi les homonymes de nom de famille : ils ne sont pas des doublons.
    mockSupabase.functions.invoke.mockResolvedValue({
      data: [contact({ id: "c2", first_name: "Marie", display_name: "Dupont Marie" })],
      error: null,
    });

    const result = await findPotentialDuplicates(ORG_ID, { first_name: "Jean", last_name: "Dupont" });

    expect(result).toEqual([]);
  });

  it("classe le motif le plus fort en premier", async () => {
    const sameEmail = contact({
      id: "c-email",
      first_name: "Zoé",
      last_name: "Autre",
      display_name: "Autre Zoé",
      email: "jean.dupont@example.fr",
    });
    const similarName = contact({ id: "c-nom", display_name: "Dupond Jean", last_name: "Dupond" });
    mockSupabase.functions.invoke.mockResolvedValue({ data: [sameEmail, similarName], error: null });

    const result = await findPotentialDuplicates(ORG_ID, {
      first_name: "Jean",
      last_name: "Dupont",
      email: "jean.dupont@example.fr",
    });

    expect(result.map((r) => r.contact.id)).toEqual(["c-email", "c-nom"]);
    expect(result[0].reasons).toContain("email");
  });

  it("borne le nombre de propositions", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      contact({ id: `c${i}`, email: "jean.dupont@example.fr" }),
    );
    mockSupabase.functions.invoke.mockResolvedValue({ data: many, error: null });

    const result = await findPotentialDuplicates(
      ORG_ID,
      { email: "jean.dupont@example.fr" },
      { limit: 3 },
    );

    expect(result).toHaveLength(3);
  });
});

describe("findPotentialDuplicates — robustesse", () => {
  it("ne remonte rien plutôt que d'échouer quand le référentiel est injoignable", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: "Référentiel de contacts injoignable." },
    });

    await expect(
      findPotentialDuplicates(ORG_ID, { first_name: "Jean", last_name: "Dupont" }),
    ).resolves.toEqual([]);
  });

  it("exploite les requêtes qui aboutissent même si une autre échoue", async () => {
    mockSupabase.functions.invoke.mockImplementation(
      (_name: string, opts: { body: { filters?: { search?: string } } }) => {
        if (opts.body.filters?.search === "Dupo") {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        return Promise.resolve({ data: [contact()], error: null });
      },
    );

    const result = await findPotentialDuplicates(ORG_ID, { first_name: "Jean", last_name: "Dupont" });

    expect(result.map((r) => r.contact.id)).toEqual(["c1"]);
  });
});
