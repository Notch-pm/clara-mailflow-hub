import { describe, expect, it } from "vitest";
import {
  buildContactDemandes,
  isInScope,
  lookupMap,
  type ContactDemandeLookups,
  type IrisListedRequest,
} from "../../../supabase/functions/_shared/iris-contact-requests";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PROC = "cccccccc-0000-4000-8000-000000000003";

const lookups: ContactDemandeLookups = {
  procedures: lookupMap([{ key: PROC, value: "Signalement voirie" }]),
  organizations: lookupMap([
    { key: ORG_A, value: "Services techniques" },
    { key: ORG_B, value: "CCAS" },
  ]),
  couriersByIrisRequest: new Map([["req-clara", "courier-1"]]),
};

const req = (over: Partial<IrisListedRequest>): IrisListedRequest => ({
  id: "req-1",
  reference: "DEM-2026-000001",
  status: "a_traiter",
  source: "portail-citoyen",
  socle_organization_id: ORG_A,
  socle_procedure_id: PROC,
  subject: "Nid de poule",
  received_at: "2026-09-01T10:00:00Z",
  ...over,
});

describe("isInScope", () => {
  it("administrateur : tout le tenant", () => {
    expect(isInScope(req({ socle_organization_id: ORG_B }), null)).toBe(true);
  });

  it("élu : ses organisations seulement, sans égard à la casse de l'UUID", () => {
    const mine = new Set([ORG_A]);
    expect(isInScope(req({ socle_organization_id: ORG_A.toUpperCase() }), mine)).toBe(true);
    expect(isInScope(req({ socle_organization_id: ORG_B }), mine)).toBe(false);
  });

  it("une demande sans organisme reste visible (même règle que les courriers)", () => {
    expect(isInScope(req({ socle_organization_id: null }), new Set([ORG_A]))).toBe(true);
  });

  it("aucune organisation rattachée : seules les demandes sans organisme", () => {
    expect(isInScope(req({}), new Set())).toBe(false);
  });
});

describe("buildContactDemandes", () => {
  it("résout les libellés depuis les miroirs et lie la demande née dans Clara à son courrier", () => {
    const [d] = buildContactDemandes([req({ id: "req-clara", source: "clara" })], lookups, null);
    expect(d).toMatchObject({
      procedure_label: "Signalement voirie",
      organization_label: "Services techniques",
      source: "clara",
      courier_id: "courier-1",
    });
  });

  it("une demande venue d'ailleurs n'a pas de courrier ; un id inconnu des miroirs reste sans libellé", () => {
    const [d] = buildContactDemandes([req({ socle_procedure_id: "inconnue" })], lookups, null);
    expect(d.courier_id).toBeNull();
    expect(d.procedure_label).toBeNull();
  });

  it("filtre le périmètre et trie la plus récente d'abord (date de réception, à défaut de création)", () => {
    const out = buildContactDemandes(
      [
        req({ id: "ancienne", received_at: "2026-08-01T00:00:00Z" }),
        req({ id: "hors-perimetre", socle_organization_id: ORG_B, received_at: "2026-09-20T00:00:00Z" }),
        req({ id: "recente", received_at: null, created_at: "2026-09-10T00:00:00Z" }),
        req({ id: undefined }),
      ],
      lookups,
      new Set([ORG_A]),
    );
    expect(out.map((d) => d.id)).toEqual(["recente", "ancienne"]);
  });
});
