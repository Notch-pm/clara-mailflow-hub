import { describe, expect, it } from "vitest";
import {
  buildContactDemandes,
  buildDemandeDetail,
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

describe("buildDemandeDetail", () => {
  const timeline = {
    request: { ...req({ id: "req-clara" }), body: "Devant le 12 rue Carnot.", socle_contact_id: "contact-1" },
    events: [
      { type: "created", at: "2026-09-01T10:00:00Z", by: null, detail: {} },
      { type: "status_changed", at: "2026-09-03T10:00:00Z", by: "Claire Agent", detail: { from: "a_traiter", to: "en_instruction" } },
    ],
    notes: [{ body: "Voir avec la voirie.", at: "2026-09-02T11:00:00Z", by: "Claire Agent" }],
    interventions: [{ status: "demandee", intervenant: "Dominique", requested_at: null, requested_for: "2026-09-25", request_comment: null, completed_on: null, completion_comment: null }],
  };

  it("enrichit la demande, garde son texte et trie le fil du plus récent au plus ancien", () => {
    const d = buildDemandeDetail(timeline, lookups, null);
    expect(d?.demande).toMatchObject({ body: "Devant le 12 rue Carnot.", courier_id: "courier-1", procedure_label: "Signalement voirie" });
    expect(d?.events.map((e) => e.type)).toEqual(["status_changed", "created"]);
    expect(d?.notes).toHaveLength(1);
    expect(d?.interventions[0].status).toBe("demandee");
  });

  it("hors périmètre : rien, pas même la demande (l'appelant répond 404)", () => {
    expect(buildDemandeDetail(timeline, lookups, new Set([ORG_B]))).toBeNull();
  });

  it("réponse illisible : rien", () => {
    expect(buildDemandeDetail({}, lookups, null)).toBeNull();
    expect(buildDemandeDetail(null, lookups, null)).toBeNull();
  });
});
