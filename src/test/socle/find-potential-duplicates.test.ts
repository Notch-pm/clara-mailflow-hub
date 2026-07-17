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

/** Corps du dernier appel passé au proxy socle-contacts. */
function lastInvokeBody(): Record<string, unknown> {
  const calls = mockSupabase.functions.invoke.mock.calls;
  return (calls[calls.length - 1][1] as { body: Record<string, unknown> }).body;
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

  it("délègue le rapprochement au Socle en un seul appel", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [], error: null });

    await findPotentialDuplicates(ORG_ID, {
      first_name: "Jean",
      last_name: "Dupont",
      email: "jean.dupont@example.fr",
    });

    expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(lastInvokeBody()).toMatchObject({
      action: "match",
      organization_id: ORG_ID,
      payload: { first_name: "Jean", last_name: "Dupont", email: "jean.dupont@example.fr" },
    });
  });

  it("transmet les fiches à écarter et la borne de résultats", async () => {
    mockSupabase.functions.invoke.mockResolvedValue({ data: [], error: null });

    await findPotentialDuplicates(ORG_ID, { last_name: "Dupont" }, { excludeIds: ["c1"], limit: 3 });

    expect(lastInvokeBody().payload).toMatchObject({ exclude_ids: ["c1"], limit: 3 });
  });
});

describe("findPotentialDuplicates — résultats", () => {
  it("relaie les candidats du Socle sans les reclasser", async () => {
    // Le Socle classe déjà : son ordre fait foi, Clara ne compare plus rien.
    const socleOrder = [
      { contact: contact({ id: "c-email" }), reasons: ["email"], score: 100 },
      { contact: contact({ id: "c-nom" }), reasons: ["name_similar"], score: 34 },
    ];
    mockSupabase.functions.invoke.mockResolvedValue({ data: socleOrder, error: null });

    const result = await findPotentialDuplicates(ORG_ID, {
      last_name: "Dupont",
      email: "jean.dupont@example.fr",
    });

    expect(result.map((r) => r.contact.id)).toEqual(["c-email", "c-nom"]);
    expect(result[0].reasons).toContain("email");
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
});
